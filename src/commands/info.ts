import { relative } from "node:path"
import { Console, Effect, Exit, Path, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import pc from "picocolors"
import { type AddonManifest, loadAddons, type When } from "../addon.ts"
import { cardModules, cardTransforms } from "../cards.ts"
import { BIN, type Failure, Invocation, printSuccess, report } from "../contract.ts"
import { alternative } from "../fix.ts"
import { introLine } from "../intro.ts"
import { slots, whyUnavailable } from "../slots.ts"
import type { SlotId, StackConfig } from "../stack.ts"
import { transformTargets } from "../transforms/index.ts"
import { versions } from "../versions.ts"
import { matches } from "../generate.ts"
import { addFailure, applyIds, parseId, readManifest } from "./add.ts"
import { TemplatesDir } from "./create.ts"

/** `info` was given no id: `available` are every add-on's ids. */
export class NoAddonId extends Schema.TaggedError<NoAddonId>()("NoAddonId", {
  available: Schema.Array(Schema.String),
}) {}

/** Something a project needs before an add-on can be added: one of `options`, for `reason`. */
export interface Requirement {
  readonly slot: string
  readonly options: ReadonlyArray<string>
  readonly reason: string
}

/** One add-on, as `info` describes it: everything here comes from its manifest and the rules. */
export interface AddonInfo {
  readonly id: string
  readonly slot: string
  readonly option: string
  readonly title: string
  readonly description: string
  readonly purpose: string | null
  readonly docs: { readonly page: string; readonly url: string | null }
  readonly service: {
    readonly name: string
    readonly file: string
    readonly errors: ReadonlyArray<string>
  } | null
  readonly layer: string | null
  readonly files: ReadonlyArray<{ readonly path: string; readonly when?: When }>
  readonly edits: ReadonlyArray<{
    readonly file: string
    readonly transforms: ReadonlyArray<string>
    readonly when?: When
  }>
  readonly dependencies: ReadonlyArray<{
    readonly name: string
    readonly version: string
    readonly package: string
    readonly dev: boolean
  }>
  readonly scripts: ReadonlyArray<{
    readonly package: string
    readonly name: string
    readonly command: string
  }>
  readonly env: ReadonlyArray<{
    readonly name: string
    readonly description: string
    readonly example: string
    readonly secret: boolean
    readonly set: boolean
    readonly when?: When
  }>
  readonly requires: ReadonlyArray<Requirement>
  readonly conflicts: ReadonlyArray<string>
  readonly card: { readonly module: string; readonly export: string; readonly when?: When } | null
  readonly agents: ReadonlyArray<{ readonly heading: string; readonly when?: When }>
}

const ids = (slot: SlotId) =>
  (slots.find((s) => s.id === slot)?.options ?? [])
    .filter((o) => o.id !== "none")
    .map((o) => `${slot}/${o.id}`)

/** What a project needs before `slot/option` can be added, from the stack rules and the manifest. */
const requirements = (slot: SlotId, option: string, m: AddonManifest): Requirement[] => {
  const out: Requirement[] = []
  const noDatabase = whyUnavailable(slot, option, { database: "none" })
  if (noDatabase !== undefined)
    out.push({ slot: "database", options: ids("database"), reason: noDatabase })
  if (
    slot === "database" &&
    whyUnavailable("orm", "none", { database: option } as Partial<StackConfig>) !== undefined
  )
    out.push({
      slot: "orm",
      options: ids("orm"),
      reason: "a database needs an ORM, added in the same command",
    })
  const runtime = whyUnavailable(slot, option, {
    runtime: "other",
  } as unknown as Partial<StackConfig>)
  if (runtime !== undefined) out.push({ slot: "runtime", options: ids("runtime"), reason: runtime })
  for (const id of m.requires)
    out.push({ slot: id.split("/")[0] as string, options: [id], reason: `${m.title} uses it` })
  return out
}

/**
 * The stacks any of `whens` names, as one `When` where it can be: variants that differ in one slot
 * merge on it, and a slot every option of which is listed drops out. Otherwise the first.
 */
const anyOf = (whens: ReadonlyArray<When | undefined>): When | undefined => {
  if (whens.length <= 1 || whens.some((w) => w === undefined)) return whens[0]
  const all = whens as ReadonlyArray<When>
  const keys = Object.keys(all[0] as When) as SlotId[]
  const differ = keys.filter((k) => new Set(all.map((w) => JSON.stringify(w[k]))).size > 1)
  const same = all.every((w) => Object.keys(w).length === keys.length)
  const slot = differ[0]
  if (!same || differ.length !== 1 || slot === undefined) return all[0]
  const merged = [...new Set(all.flatMap((w) => w[slot] ?? []))]
  const options = slots.find((s) => s.id === slot)?.options.map((o) => o.id) ?? []
  const { [slot]: _, ...rest } = all[0] as When
  const out: When = options.every((o) => merged.includes(o)) ? rest : { ...rest, [slot]: merged }
  return Object.keys(out).length === 0 ? undefined : out
}

const withWhen = <A extends object>(a: A, when: When | undefined): A & { when?: When } =>
  when === undefined ? a : { ...a, when }

/**
 * Everything `info` says about the add-on `m`. With `stack` (a project's, with the add-on in it),
 * only the files, env vars and AGENTS.md sections that stack gets, without their conditions.
 */
export const describeAddon = (m: AddonManifest, stack?: StackConfig): AddonInfo => {
  const on = <A extends { readonly when?: When | undefined }>(xs: ReadonlyArray<A>) =>
    stack === undefined ? xs : xs.filter((x) => matches(x.when, stack))
  const cond = (when: When | undefined) => (stack === undefined ? when : undefined)
  const [slot, option] = m.id.split("/") as [SlotId, string]
  const def = slots.find((s) => s.id === slot)
  const addLayer = m.transforms.find((t) => t.name === "addLayer")
  // by file and, outside a project, by the stacks that get the edit
  const edits = new Map<string, { file: string; transforms: string[]; when?: When }>()
  for (const t of on([...m.transforms, ...cardTransforms(m)]))
    for (const file of transformTargets(t)) {
      const when = cond(t.when)
      const key = `${file}\0${JSON.stringify(when ?? null)}`
      const e = edits.get(key) ?? withWhen({ file, transforms: [] as string[] }, when)
      if (!e.transforms.includes(t.name)) e.transforms.push(t.name)
      edits.set(key, e)
    }
  const deps = (section: AddonManifest["dependencies"], dev: boolean) =>
    Object.entries(section).flatMap(([pkg, names]) =>
      names.map((name) => ({
        name,
        version: name.startsWith("@repo/") ? "workspace:*" : (versions[name] ?? "unpinned"),
        package: pkg,
        dev,
      })),
    )
  return {
    id: m.id,
    slot,
    option,
    title: m.title,
    description: m.description,
    purpose: m.guide?.purpose ?? null,
    docs: { page: `docs/addons/${slot}-${option}.md`, url: m.docs ?? null },
    service: m.guide?.service ?? null,
    layer: addLayer?.args.layer ?? null,
    files: on([...m.files, ...(m.card?.files ?? [])])
      .map((f) => withWhen({ path: f.target }, cond(f.when)))
      .filter((f, i, all) => f.when !== undefined || all.findIndex((g) => g.path === f.path) === i)
      .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    edits: [...edits.values()].toSorted((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)),
    dependencies: [...deps(m.dependencies, false), ...deps(m.devDependencies, true)],
    scripts: Object.entries(m.scripts ?? {}).flatMap(([pkg, scripts]) =>
      Object.entries(scripts).map(([name, command]) => ({ package: pkg, name, command })),
    ),
    env: on(m.envVars).map((v) =>
      withWhen(
        {
          name: v.name,
          description: v.description,
          example: v.example,
          secret: v.secret === true,
          // the same meaning as in create and add: efforge writes a value that works locally
          set: v.dev !== undefined,
        },
        cond(v.when),
      ),
    ),
    requires: requirements(slot, option, m),
    // a single-choice slot holds one option; extras go together
    conflicts: [
      ...(def?.multi === false ? ids(slot).filter((id) => id !== m.id) : []),
      ...m.conflicts,
    ],
    card:
      m.card === undefined || on(cardModules(m.card)).length === 0
        ? null
        : withWhen(
            { module: (m.card.files[0] as { target: string }).target, export: m.card.export },
            cond(anyOf(cardModules(m.card).map((f) => f.when))),
          ),
    agents: on(m.transforms)
      .filter((t) => t.name === "appendAgentsSection")
      .flatMap((t) => {
        const heading = /^#{2,3} (.+)$/m.exec(t.args.content ?? "")?.[1]
        return heading === undefined ? [] : [withWhen({ heading }, cond(t.when))]
      }),
  }
}

/** The project in `dir` and the add-on: whether it has it, and the command that adds it. */
const inProject = (
  dir: string,
  stack: StackConfig,
  id: string,
): {
  readonly directory: string
  readonly installed: boolean
  readonly add: string | null
  readonly alternatives: ReadonlyArray<string>
  readonly reason?: string
  /** The project's stack with the add-on, when it has it or can add it alone. */
  readonly with?: StackConfig
} => {
  const [slot, option] = id.split("/") as [SlotId, string]
  const installed =
    slot === "extras" ? stack.extras.includes(option as never) : stack[slot] === option
  const cwd = relative(process.cwd(), dir) || "."
  const addArgs = ["add", id, ...(cwd === "." ? [] : ["--cwd", cwd])]
  const command = alternative(addArgs, (i) => i)
  if (installed) return { directory: dir, installed, add: null, alternatives: [], with: stack }
  const exit = Effect.runSyncExit(applyIds(stack, [id]))
  if (Exit.isSuccess(exit))
    return { directory: dir, installed, add: command, alternatives: [], with: exit.value.stack }
  const e = exit.cause.reasons.find((r) => r._tag === "Fail")?.error as
    | { _tag: string; reason?: string; ways?: string[][]; current?: string }
    | undefined
  if (e?._tag === "SlotAlreadySet")
    return {
      directory: dir,
      installed,
      add: null,
      alternatives: [],
      reason: `this project's ${slot} is ${String(e.current)}, and add can't swap it`,
    }
  const alternatives = (e?.ways ?? []).flatMap((w) => {
    const c = alternative(["add", ...w, id, ...addArgs.slice(2)], (i) => i)
    return c === null ? [] : [c]
  })
  return {
    directory: dir,
    installed,
    add: null,
    alternatives,
    reason: (e?.reason ?? "not compatible with this project's stack").replace(
      / \(alternatives lists the ways\)$/,
      "",
    ),
  }
}

const label = (s: string) => pc.dim(s.padEnd(11))

const whenText = (when: When | undefined) =>
  when === undefined
    ? ""
    : pc.dim(
        ` (with ${Object.entries(when)
          .map(([slot, values]) => `${slot}=${values.join("|")}`)
          .join(", ")})`,
      )

/** Word-wraps `text` to `width` columns, each line after `indent`. */
const wrap = (text: string, width: number, indent: string): string => {
  const lines: string[] = []
  let line = ""
  for (const word of text.split(/\s+/)) {
    if (line !== "" && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else line = line === "" ? word : `${line} ${word}`
  }
  if (line !== "") lines.push(line)
  return lines.map((l) => `${indent}${l}`).join("\n")
}

/** `info` for people: the same facts as `--json`, one block per kind. */
export const renderInfo = (
  a: AddonInfo,
  project: ReturnType<typeof inProject> | undefined,
): string => {
  const width = Math.max(40, Math.min(100, (process.stdout.columns || 100) - 2))
  const out: string[] = [`${pc.bold(a.title)}  ${pc.cyan(a.id)}`, wrap(a.description, width, "")]
  if (a.purpose !== null) out.push("", wrap(a.purpose, width, ""))
  out.push("")
  const row = (name: string, lines: ReadonlyArray<string>) => {
    if (lines.length === 0) return
    out.push(`${label(name)} ${lines[0]}`, ...lines.slice(1).map((l) => `${" ".repeat(12)}${l}`))
  }
  if (a.service !== null)
    row("service", [
      `${a.service.name} in ${a.service.file}${a.service.errors.length > 0 ? pc.dim(`, fails with ${a.service.errors.join(", ")}`) : ""}`,
    ])
  if (a.layer !== null)
    row("layer", [`${a.layer} ${pc.dim("in AppLayer (apps/web/src/server/layers.ts)")}`])
  row(
    "needs",
    a.requires.length === 0
      ? ["nothing else"]
      : a.requires.map((r) => `${r.options.join(" or ")} ${pc.dim(`(${r.reason})`)}`),
  )
  row("conflicts", a.conflicts.length === 0 ? ["nothing"] : [a.conflicts.join(", ")])
  // a file written on several stacks, each its own way, is one line here
  const paths = [...new Set(a.files.map((f) => f.path))]
  row(
    "writes",
    paths.length === 0
      ? ["no files"]
      : paths.map((path) => {
          const all = a.files.filter((f) => f.path === path)
          return all.length > 1
            ? `${path}${pc.dim(" (on some stacks)")}`
            : `${path}${whenText(all[0]?.when)}`
        }),
  )
  row(
    "edits",
    a.edits.map((e) => `${e.file} ${pc.dim(`(${e.transforms.join(", ")})`)}${whenText(e.when)}`),
  )
  row(
    "packages",
    a.dependencies.length === 0
      ? ["none"]
      : a.dependencies.map(
          (d) => `${d.name}@${d.version} ${pc.dim(`in ${d.package}${d.dev ? ", dev" : ""}`)}`,
        ),
  )
  row(
    "scripts",
    a.scripts.map((s) => `${s.name} ${pc.dim(`in ${s.package}: ${s.command}`)}`),
  )
  row(
    "env",
    a.env.length === 0
      ? ["none"]
      : a.env.map(
          (v) =>
            `${v.name}${pc.dim(v.secret && !v.set ? " (a secret; you fill it in)" : v.secret ? " (a secret; a local value is written)" : !v.set ? " (you fill it in)" : "")}${whenText(v.when)}`,
        ),
  )
  row("card", [
    a.card === null ? "none" : `${a.card.module} ${pc.dim("(on /app)")}${whenText(a.card.when)}`,
  ])
  row(
    "AGENTS.md",
    a.agents.length === 0 ? ["none"] : a.agents.map((s) => `"${s.heading}"${whenText(s.when)}`),
  )
  row("docs", [a.docs.page, ...(a.docs.url === null ? [] : [pc.dim(a.docs.url)])])
  if (project !== undefined) {
    out.push("")
    out.push(
      project.installed
        ? `${pc.green("✓")} This project has it.`
        : project.add !== null
          ? `This project doesn't have it. Add it: ${pc.cyan(project.add)}`
          : `This project can't add it alone: ${project.reason ?? "not compatible"}.${project.alternatives.length > 0 ? `\n${project.alternatives.map((c) => `  ${pc.cyan(c)}`).join("\n")}` : ""}`,
    )
  }
  return out.join("\n")
}

/** What went wrong in `info`, as the contract reports it: `add`'s errors, and a missing id. */
export const infoFailure = (
  e: { readonly _tag: string; readonly message?: string } & Record<string, unknown>,
  args: ReadonlyArray<string>,
): Failure =>
  e._tag === "NoAddonId"
    ? {
        code: "NoAddonIds",
        message: `Name the add-on to describe: ${(e.available as string[]).join(", ")}.${(() => {
          const list = alternative(args, (i) => ({
            ...i,
            verb: "list",
            word: "list",
            operands: [],
            flags: i.flags.filter((f) => f.name === "json" || f.name === "cwd"),
          }))
          return list === null ? "" : ` What each one adds: ${list}`
        })()}`,
        // listing isn't describing: which add-on is the caller's choice (`available`)
        fix: null,
        details: { available: e.available as string[] },
      }
    : (() => {
        const f = addFailure(e, args)
        // outside `add`, a list is every add-on, not what a project can add
        return {
          ...f,
          message: f.message.replace("See which ones this project can add:", "See every add-on:"),
        }
      })()

const allIds = slots.flatMap((s) =>
  s.options.filter((o) => o.id !== "none").map((o) => `${s.id}/${o.id}`),
)

export const infoCommand = Command.make(
  "info",
  {
    id: Argument.String("id").pipe(
      Argument.withDescription("The add-on: email, extras/email, ai, ..."),
      Argument.optional,
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription(
        "Print one JSON document on stdout, nothing else (https://github.com/amagdy46/efforge/blob/main/docs/json.md)",
      ),
      Flag.withDefault(false),
    ),
    cwd: Flag.String("cwd").pipe(
      Flag.withDescription("Say whether this efforge project has it (default: current directory)"),
      Flag.withDefault("."),
    ),
  },
  (input) =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const dir = path.resolve(input.cwd)
      if (input.id._tag === "None") return yield* new NoAddonId({ available: allIds })
      const { slot, option } = yield* parseId(input.id.value)
      const id = `${slot.id}/${option}`
      const addons = yield* loadAddons(yield* TemplatesDir)
      const m = addons.get(id)?.manifest
      if (m === undefined) return yield* new NoAddonId({ available: allIds })
      // outside a project, describe the add-on alone; a --cwd that doesn't exist is a mistake
      const stack = yield* readManifest(dir).pipe(
        Effect.map((x) => x.stack),
        Effect.catchTag("NotAnEfforgeProject", (e) =>
          e.reason === "efforge.jsonc not found" && input.cwd === "."
            ? Effect.succeed(undefined)
            : Effect.fail(e),
        ),
      )
      const project = stack === undefined ? undefined : inProject(dir, stack, id)
      const info = describeAddon(m, project?.with)
      if (input.json) {
        const { with: _, ...facts } = project ?? {}
        return yield* printSuccess({
          ...info,
          ...(project === undefined ? {} : { project: facts }),
        })
      }
      const lines = [renderInfo(info, project)]
      if (process.stdout.isTTY) lines.unshift(introLine(`info ${id}`), "")
      yield* Console.log(lines.join("\n"))
    }).pipe(
      Effect.catch((e) =>
        Effect.gen(function* () {
          const args = yield* Invocation
          yield* report(input.json, infoFailure(e as never, args))
        }),
      ),
    ),
).pipe(
  Command.withDescription("Describe one add-on: what it adds and edits, what it needs"),
  Command.withExamples([
    { command: `${BIN} info email`, description: "What the email add-on adds" },
    { command: `${BIN} info ai --json`, description: "The same, as data" },
  ]),
)
