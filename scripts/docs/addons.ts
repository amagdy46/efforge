// `pnpm docs:addons`: writes docs/addons/<slot>-<option>.md and docs/addons/README.md from the
// add-on manifests (templates/<slot>/<option>/addon.json), versions.ts and slots.ts. The prose comes
// from each manifest's `guide`; a service's methods are read from the file that declares it.
// test/docs.test.ts fails while a page is stale.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Exit, type FileSystem, Path } from "effect"
import { Node, Project, type TypeNode } from "ts-morph"
import { type AddonManifest, type LoadedAddon, loadAddons, type When } from "../../src/addon.ts"
import { cardTransforms } from "../../src/cards.ts"
import { waysOut } from "../../src/commands/add.ts"
import { generate, matches } from "../../src/generate.ts"
import { validate } from "../../src/rules.ts"
import { slots, whyUnavailable } from "../../src/slots.ts"
import { type SlotId, type StackConfig, withDefaults } from "../../src/stack.ts"
import { transformTargets } from "../../src/transforms/index.ts"
import { WRANGLER_FILE } from "../../src/transforms/addWranglerBinding.ts"
import { versions } from "../../src/versions.ts"

export const root = fileURLToPath(new URL("../..", import.meta.url))
export const pagesDir = "docs/addons"

const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Path.layer)))

/** Every add-on but `base`, which is the project itself. */
export const readAddons = (): Promise<ReadonlyMap<string, LoadedAddon>> =>
  run(loadAddons(join(root, "templates")))

/** `extras/email` -> `extras-email.md` */
export const pageName = (id: string) => `${id.replace("/", "-")}.md`

const code = (s: string) => (s.includes("`") ? `\`\` ${s} \`\`` : `\`${s}\``)

/**
 * `<` and `>` outside code spans and fenced blocks, as entities: GitHub drops what looks like an
 * unknown HTML tag (`<domain>`), so every manifest text goes through this on its way to a page.
 */
export const escapeMarkdown = (text: string): string =>
  text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/</g, "&lt;").replace(/>/g, "&gt;")))
    .join("")

const whenText = (when: When | undefined) =>
  when === undefined
    ? ""
    : Object.entries(when)
        .map(([slot, values]) => values.map((v) => code(`${slot}=${v}`)).join(" or "))
        .join(" and ")

const describe = (t: AddonManifest["transforms"][number]): string => {
  const a = t.args
  switch (t.name) {
    case "addImport":
      return `Imports ${code(a.import ?? "")} from ${code(a.from ?? "")}.`
    case "addExport":
      return a.export === "*"
        ? `Re-exports everything from ${code(a.from ?? "")}.`
        : `Exports ${code(a.export ?? "")} from ${code(a.from ?? "")}.`
    case "addLayer":
      return `Adds ${code(a.layer ?? "")} to ${code("AppLayer")}, imported from ${code(a.from ?? "")}.`
    case "addArrayItem":
      return `Adds ${code(a.item ?? "")} to ${code(a.name ?? "")}.`
    case "addServerFnMiddleware":
      return `Runs ${code(a.middleware ?? "")} before every server function in the file.`
    case "addAuthPlugin":
      return a.mergeInto === undefined
        ? `Adds the ${code(a.call ?? "")} plugin to Better Auth.`
        : `Sets ${code(a.property ?? "")} in the options of the ${code(a.mergeInto)} plugin.`
    case "addWranglerBinding":
      return `Adds a ${code(a.key ?? "")} entry: ${code(a.value ?? "")}.`
    case "setWranglerValue":
      return `Sets ${code(a.key ?? "")} to ${code(a.value ?? "")}.`
    case "addAlchemyResource":
      return `Declares ${code(a.name ?? "")} and binds it to the Worker as ${code(a.binding ?? "")}.`
    case "addWorkflowSecret":
      return `Passes the ${code(a.name ?? "")} secret to the deploy job.`
    case "addDevVar":
      return `Sets ${code(`${a.name}=${a.value}`)} for local development.`
    case "appendAgentsSection":
      return "Adds the rules under [Rules it adds to AGENTS.md](#rules-it-adds-to-agentsmd)."
    default:
      throw new Error(`scripts/docs/addons.ts has no description for the transform "${t.name}"`)
  }
}

/** The project with nothing chosen but the runtime. */
const bare = withDefaults({
  name: "my-app",
  database: "none",
  orm: "none",
  auth: "none",
  infra: "none",
  ai: "none",
  extras: [],
})

const isValid = (stack: StackConfig) => Exit.isSuccess(Effect.runSyncExit(validate(stack)))

const without = (stack: StackConfig, slot: SlotId, option: string): StackConfig =>
  slot === "extras"
    ? { ...stack, extras: stack.extras.filter((e) => e !== option) }
    : { ...stack, [slot]: "none" }

const withAddon = (stack: StackConfig, slot: SlotId, option: string): StackConfig =>
  slot === "extras"
    ? { ...stack, extras: [...stack.extras, option as StackConfig["extras"][number]] }
    : { ...stack, [slot]: option }

/** Every valid stack that has `slot/option`. */
const stacksWith = (() => {
  const cache = new Map<string, StackConfig[]>()
  return (slot: SlotId, option: string): StackConfig[] => {
    const key = `${slot}/${option}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    let stacks: StackConfig[] = [bare]
    for (const s of slots) {
      const values = s.options.map((o) => o.id)
      stacks = stacks.flatMap((stack) =>
        s.multi
          ? values.reduce<StackConfig[]>(
              (acc, v) => [...acc, ...acc.map((x) => withAddon(x, s.id, v))],
              [stack],
            )
          : values.map((v) => withAddon(stack, s.id, v)),
      )
    }
    const out = stacks.filter(
      (st) =>
        (slot === "extras" ? st.extras.includes(option as never) : st[slot] === option) &&
        isValid(st),
    )
    cache.set(key, out)
    return out
  }
})()

/**
 * `whens` in their shortest form for the add-on: no conditions when together they hold on every
 * stack it can be in, and otherwise each without the slots that make no difference there.
 */
const simplify = (slot: SlotId, option: string, whens: ReadonlyArray<When | undefined>) => {
  if (whens.includes(undefined)) return []
  const stacks = stacksWith(slot, option)
  const hits = (ws: ReadonlyArray<When>) =>
    stacks.map((st) => ws.some((w) => matches(w, st))).join()
  let ws = whens as When[]
  const target = hits(ws)
  if (stacks.every((st) => ws.some((w) => matches(w, st)))) return []
  for (let i = 0; i < ws.length; i++)
    for (const key of Object.keys(ws[i] ?? {})) {
      const { [key as SlotId]: _, ...rest } = ws[i] as When
      const next = ws.map((w, j) => (j === i ? rest : w))
      if (hits(next) === target) ws = next
    }
  const seen = new Set<string>()
  return ws.filter((w) => {
    const k = JSON.stringify(w)
    return !seen.has(k) && (seen.add(k), true)
  })
}

const conditionText = (ws: ReadonlyArray<When>) => ws.map(whenText).join(", or ")

/** ` Only with ...` for one add-on's `when`s, or nothing. */
const onlyWhenFor =
  (slot: SlotId, option: string) =>
  (...whens: Array<When | undefined>) => {
    const ws = simplify(slot, option, whens)
    return ws.length === 0 ? "" : ` Only with ${conditionText(ws)}.`
  }

/** One way to add the add-on: to `from`, a project that lacks it, run `ids`. */
export interface AddCommand {
  readonly intro: string
  readonly from: StackConfig
  readonly ids: ReadonlyArray<string>
}

/** Why `slot/option` needs `others` in the same command, and which other choices work. */
const together = (slot: SlotId, others: ReadonlyArray<string>, rest: string): string => {
  const needed = others.map((id) => id.split("/")[0]).join(",")
  if (slot === "database" && needed === "orm")
    return `A database needs an ORM, so a project without a database gets both in one command (${rest} works too):`
  if (slot === "orm" && needed === "database")
    return `An ORM needs a database, and a project without an ORM has no database either, so add both in one command (${rest} works too):`
  if (needed === "database,orm")
    return `${slots.find((s) => s.id === slot)?.title ?? slot} needs a database. On a project without one, add a database and an ORM in the same command (any of them works):`
  throw new Error(`scripts/docs/addons.ts: say why ${slot} needs ${needed}`)
}

/**
 * The commands that add `slot/option` to an existing project, each with the project it is for:
 * the default stack without the add-on, then a project with nothing chosen. Where the add-on needs
 * a choice in another slot, the command makes it too, as `add` itself suggests (`waysOut`).
 */
export const addCommands = (slot: SlotId, option: string): AddCommand[] => {
  const out: AddCommand[] = []
  const def = slots.find((s) => s.id === slot)
  if (def === undefined || def.options.length === 1) return out
  for (const from of [without(withDefaults({ name: "my-app" }), slot, option), bare]) {
    if (!isValid(from)) continue
    const target = withAddon(from, slot, option)
    if (isValid(target)) {
      const ids = [`${slot}/${option}`]
      if (out.some((c) => c.ids.join(" ") === ids.join(" "))) continue
      out.push({
        intro: def.multi
          ? "Add it to an existing project:"
          : `Add it to an existing project whose \`${slot}\` is \`none\`:`,
        from,
        ids,
      })
      continue
    }
    const [first, ...others] = waysOut(target, new Set([slot]))
    if (first === undefined) continue
    const rest = others.map((w) => w.map(code).join(" and ")).join(" or ")
    const order = (id: string) => slots.findIndex((x) => x.id === id.split("/")[0])
    const ids = [...first, `${slot}/${option}`].toSorted((a, b) => order(a) - order(b))
    out.push({ intro: together(slot, first, rest), from, ids })
  }
  return out
}

const commands = (slot: SlotId, option: string) => {
  const def = slots.find((s) => s.id === slot)
  if (def === undefined) throw new Error(`unknown slot ${slot}`)
  if (def.options.length === 1)
    return [
      "Every project has it; there is nothing to choose.",
      "",
      "```sh",
      `npm create efforge my-app`,
      "```",
    ]
  const lines = [
    "When you create the project:",
    "",
    "```sh",
    `npm create efforge my-app -- --${slot}=${option}`,
    "```",
  ]
  for (const c of addCommands(slot, option))
    lines.push("", c.intro, "", "```sh", `npx create-efforge add ${c.ids.join(" ")}`, "```")
  return lines
}

/** The compatibility rules from slots.ts, as sentences; the commands are under "Add it". */
const needs = (slot: SlotId, option: string, m: AddonManifest): string[] => {
  const out: string[] = []
  if (whyUnavailable(slot, option, { database: "none" }) !== undefined)
    out.push("A database, and with it an ORM ([Add it](#add-it) has the command).")
  if (
    slot === "database" &&
    whyUnavailable("orm", "none", { database: option } as Partial<StackConfig>) !== undefined
  )
    out.push("An ORM, added in the same command ([Add it](#add-it) has it).")
  if (
    whyUnavailable(slot, option, { runtime: "other" } as unknown as Partial<StackConfig>) !==
    undefined
  )
    out.push("The Cloudflare runtime, which every project has today.")
  for (const id of m.requires) out.push(`[${id}](${pageName(id)}).`)
  return out
}

/** A member of a service's interface, read from its declaration. */
export interface Member {
  /** `send(message)`, or `list` for an Effect that is not a function */
  readonly signature: string
  /** The tagged errors in its type's error channel */
  readonly errors: ReadonlyArray<string>
  readonly doc: string | undefined
}

const errorsOf = (node: TypeNode | undefined): string[] => {
  if (node === undefined || !Node.isTypeReference(node)) return []
  if (node.getTypeName().getText() !== "Effect.Effect") return []
  const error = node.getTypeArguments()[1]
  if (error === undefined) return []
  const parts = Node.isUnionTypeNode(error) ? error.getTypeNodes() : [error]
  return parts.map((p) => p.getText()).filter((t) => /^[A-Z]\w*$/.test(t) && t !== "never")
}

const sourceProject = new Project({
  useInMemoryFileSystem: true,
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
})

/** The members of `class <name> extends Context.Service<name, { ... }>()(...)` in `text`. */
export const serviceMembers = (text: string, name: string): Member[] => {
  const file = sourceProject.createSourceFile("/service.ts", text, { overwrite: true })
  const shape = file
    .getClassOrThrow(name)
    .getExtends()
    ?.getFirstDescendant(
      (n) =>
        Node.isCallExpression(n) &&
        n.getExpression().getText() === "Context.Service" &&
        n.getTypeArguments().length === 2,
    )
  const literal = Node.isCallExpression(shape) ? shape.getTypeArguments()[1] : undefined
  if (literal === undefined || !Node.isTypeLiteral(literal))
    throw new Error(`${name}: no Context.Service<${name}, { ... }> shape`)
  return literal.getProperties().map((p) => {
    const type = p.getTypeNode()
    const doc = p.getJsDocs()[0]?.getDescription().trim().replace(/\s+/g, " ")
    if (Node.isFunctionTypeNode(type)) {
      const params = type
        .getParameters()
        .map((q) => `${q.getName()}${q.hasQuestionToken() ? "?" : ""}`)
      return {
        signature: `${p.getName()}(${params.join(", ")})`,
        errors: errorsOf(type.getReturnTypeNode()),
        doc: doc === "" ? undefined : doc,
      }
    }
    return { signature: p.getName(), errors: errorsOf(type), doc: doc === "" ? undefined : doc }
  })
}

const demote = (markdown: string) => markdown.replace(/^(#{1,5}) /gm, "#$1 ")

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

const page = (m: AddonManifest, dir: string, existing: ReadonlySet<string>): string => {
  const [slot, option] = m.id.split("/") as [SlotId, string]
  const def = slots.find((s) => s.id === slot)
  const layer = m.transforms.find((t) => t.name === "addLayer")
  const agents = m.transforms.filter((t) => t.name === "appendAgentsSection")
  const onlyWhen = onlyWhenFor(slot, option)
  const slotLine =
    def === undefined
      ? ""
      : def.multi
        ? ` It is one of the ${def.title}: a project can have any number of them.`
        : def.options.length === 1
          ? ` It is the ${def.title}, and every project has it.`
          : ` It fills the ${def.title} slot: a project makes one ${def.title} choice, or none.`
  const lines: string[] = [
    `<!-- Generated by pnpm docs:addons from templates/${m.id}/addon.json. Do not edit: change the manifest and run pnpm docs:addons. -->`,
    "",
    `# ${m.title}`,
    "",
    escapeMarkdown(m.description),
    "",
    `Id ${code(m.id)}.${slotLine} Template: [\`templates/${m.id}/\`](../../templates/${m.id}/).`,
    "",
    "## What it is for",
    "",
    escapeMarkdown(m.guide?.purpose ?? m.description),
  ]

  lines.push("", "## Add it", "", ...commands(slot, option))

  const needed = needs(slot, option, m)
  lines.push("", "## Needs", "")
  lines.push(...(needed.length === 0 ? ["Nothing else."] : needed.map((n) => `- ${n}`)))
  lines.push("", "## Conflicts with", "")
  lines.push(
    ...(m.conflicts.length === 0
      ? ["Nothing."]
      : m.conflicts.map((id) => `- [${id}](${pageName(id)})`)),
  )

  lines.push("", "## Service and layer", "")
  const service = m.guide?.service
  if (service === undefined || layer === undefined)
    lines.push("None: this add-on adds no service of its own.")
  else {
    const source = m.files.find((f) => f.target === service.file)
    if (source === undefined) throw new Error(`${m.id}: no file targets ${service.file}`)
    const members = serviceMembers(readFileSync(join(dir, source.path), "utf8"), service.name)
    const layerName = layer.args.import ?? ""
    lines.push(
      `Your code asks for ${code(service.name)}, declared in ${code(service.file)}. ${plural(members.length, "It has one member", "Its members")}:`,
      "",
    )
    for (const member of members) {
      const fails =
        member.errors.length === 0 ? "" : ` Fails with ${member.errors.map(code).join(" or ")}.`
      const doc = member.doc === undefined ? "" : ` ${escapeMarkdown(member.doc)}`
      lines.push(`- ${code(member.signature)}.${doc}${fails}`.replace(/\.\. /g, ". "))
    }
    const methodErrors = new Set(members.flatMap((x) => x.errors))
    const buildErrors = service.errors.filter((e) => !methodErrors.has(e))
    lines.push(
      "",
      `${code(layerName)} implements it, and \`efforge add\` puts it in \`AppLayer\` in \`apps/web/src/server/layers.ts\`.${buildErrors.length === 0 ? "" : ` Building the layer fails with ${buildErrors.map(code).join(" or ")} when a setting is missing or invalid.`}`,
      "",
      `- To test code that uses ${code(service.name)}, give it a test layer: ${code(`Layer.succeed(${service.name}, ${service.name}.of({ ... }))`)}. See [Swap a layer to test](../testing.md).`,
      `- To change the provider, write another layer for ${code(service.name)} and use it in \`layers.ts\` in place of ${code(layerName)}.`,
    )
    if (m.guide?.swap !== undefined) lines.push(`- ${escapeMarkdown(m.guide.swap)}`)
  }

  const files = [...m.files, ...(m.card?.files ?? [])]
  const replaced = files
    .filter((f) => f.ifAbsent !== true && existing.has(f.target))
    .map((f) => f.target)
  lines.push("", "## Files it writes", "")
  if (files.length === 0) lines.push("None.")
  else {
    lines.push(
      replaced.length === 0
        ? "`efforge add` writes these files."
        : "`efforge add` writes these files. A file marked *replaces* is one efforge generated before; it is replaced only if you have not edited it, and otherwise `add` changes nothing and shows the diff.",
      "",
    )
    const byTarget = new Map<string, Array<When | undefined>>()
    for (const f of files) byTarget.set(f.target, [...(byTarget.get(f.target) ?? []), f.when])
    const conditions = [...byTarget].map(
      ([target, whens]) => [target, conditionText(simplify(slot, option, whens))] as const,
    )
    const ifAbsent = new Set(files.filter((f) => f.ifAbsent === true).map((f) => f.target))
    const mark = (target: string) =>
      ifAbsent.has(target)
        ? " (*only if missing*)"
        : replaced.includes(target)
          ? " (*replaces*)"
          : ""
    if (conditions.every(([, c]) => c === ""))
      for (const [target] of conditions) lines.push(`- ${code(target)}${mark(target)}`)
    else {
      lines.push("| File | Only with |", "| --- | --- |")
      for (const [target, c] of conditions)
        lines.push(`| ${code(target)}${mark(target)} | ${c === "" ? "Always" : c} |`)
    }
  }
  if (m.id === "infra/alchemy")
    lines.push(
      "",
      `It removes ${code(WRANGLER_FILE)}, because \`infra/alchemy.run.ts\` declares the Worker instead. If you edited ${code(WRANGLER_FILE)}, \`add\` stops and shows the diff.`,
    )

  lines.push("", "## Files it edits", "")
  lines.push(
    "`efforge add` makes these edits with AST transforms (changes to the parsed code, not to its text), so it changes only what is listed and leaves the rest of each file alone.",
  )
  const byFile = new Map<string, string[]>()
  const edit = (file: string, text: string) => byFile.set(file, [...(byFile.get(file) ?? []), text])
  // the same edit under several conditions is one line, with the conditions together
  const grouped = new Map<string, { file: string; text: string; whens: Array<When | undefined> }>()
  for (const t of [...m.transforms, ...cardTransforms(m)]) {
    const targets = transformTargets(t)
    if (targets.length === 0) throw new Error(`${m.id}: ${t.name} has no target file`)
    for (const file of targets) {
      const text = describe(t)
      const key = `${file}\n${text}`
      const g = grouped.get(key) ?? { file, text, whens: [] }
      g.whens.push(t.name === "appendAgentsSection" ? undefined : t.when)
      grouped.set(key, g)
    }
  }
  for (const g of grouped.values()) edit(g.file, `${g.text}${onlyWhen(...g.whens)}`)
  const deps = [...Object.entries(m.dependencies), ...Object.entries(m.devDependencies)]
  if (deps.some(([, names]) => names.length > 0)) {
    const dirs = [...new Set(deps.filter(([, n]) => n.length > 0).map(([d]) => d))]
    for (const d of dirs)
      edit(d === "." ? "package.json" : `${d}/package.json`, "Adds the dependencies listed below.")
    edit("pnpm-workspace.yaml", "Pins the new dependencies in the `catalog`.")
  }
  for (const [d, scripts] of Object.entries(m.scripts ?? {})) {
    const names = Object.keys(scripts)
    edit(
      d === "." ? "package.json" : `${d}/package.json`,
      `Sets the ${plural(names.length, "script", "scripts")} ${names.map(code).join(", ")}; a script of the same name is replaced.`,
    )
  }
  if (m.envVars.length > 0) edit(".env.example", "Adds the environment variables listed below.")
  edit("efforge.jsonc", "Records the add-on in the stack and the hashes of the files it wrote.")
  for (const [file, edits] of byFile) {
    lines.push("", `### ${code(file)}`, "")
    for (const e of edits) lines.push(`- ${e}`)
  }

  lines.push("", "## Dependencies", "")
  if (!deps.some(([, names]) => names.length > 0)) lines.push("None.")
  else {
    lines.push("| Package | Version | Workspace |", "| --- | --- | --- |")
    for (const [kind, record] of [
      ["", m.dependencies],
      [" (dev)", m.devDependencies],
    ] as const)
      for (const [d, names] of Object.entries(record))
        for (const name of names) {
          const version = name.startsWith("@repo/") ? "workspace" : versions[name]
          if (version === undefined) throw new Error(`${m.id}: no version for ${name}`)
          lines.push(`| ${code(name)} | ${code(version)} | ${code(d)}${kind} |`)
        }
  }

  lines.push("", "## Environment variables", "")
  if (m.envVars.length === 0) lines.push("None.")
  for (const v of m.envVars) {
    const example = v.example === "" ? "" : `, for example ${code(v.example)}`
    lines.push(
      `- ${code(v.name)}${example}: ${escapeMarkdown(v.description.replace(/\.$/, ""))}.${onlyWhen(v.when)}`,
    )
  }

  lines.push("", "## Package scripts", "")
  const scripts = Object.entries(m.scripts ?? {})
  if (scripts.length === 0) lines.push("None.")
  for (const [d, record] of scripts)
    for (const [name, command] of Object.entries(record))
      lines.push(
        `- ${code(name)} in ${code(d === "." ? "package.json" : `${d}/package.json`)}: ${code(command)}`,
      )

  lines.push("", "## Rules it adds to AGENTS.md", "")
  if (agents.length === 0) lines.push("None.")
  for (const t of agents) {
    const cond = simplify(slot, option, [t.when])
    if (cond.length > 0) lines.push(`Only with ${conditionText(cond)}:`, "")
    lines.push(escapeMarkdown(demote(t.args.content ?? "")), "")
  }
  if (agents.length > 0) lines.pop()

  lines.push("", "## Limits", "")
  const limits = m.guide?.limits ?? []
  if (limits.length === 0)
    lines.push("None known. The general ones are in [Status and limits](../limits.md).")
  for (const l of limits) lines.push(`- ${escapeMarkdown(l)}`)

  return `${lines.join("\n")}\n`
}

const index = (addons: ReadonlyArray<AddonManifest>): string => {
  const lines = [
    "<!-- Generated by pnpm docs:addons from templates/*/*/addon.json. Do not edit. -->",
    "",
    "# Add-ons",
    "",
    "A slot is one decision about the stack: the database, the ORM, auth, and so on. Each add-on is one choice in one slot. Most slots take one choice or none; Extras takes any number. Pick them when you create a project, or add them later with `npx create-efforge add <slot>/<option>`. Every page has the same headings: What it is for, Add it, Needs, Conflicts with, Service and layer, Files it writes, Files it edits, Dependencies, Environment variables, Package scripts, Rules it adds to AGENTS.md, Limits.",
    "",
    "`npx create-efforge list` prints the same list, and `list --json` prints it as JSON.",
  ]
  for (const slot of slots) {
    const inSlot = addons.filter((m) => m.id.startsWith(`${slot.id}/`))
    if (inSlot.length === 0) continue
    lines.push("", `## ${slot.title} (\`${slot.id}\`)`, "")
    for (const m of inSlot)
      lines.push(
        `- [${m.title}](${pageName(m.id)}) (\`${m.id}\`): ${escapeMarkdown(m.description)}`,
      )
  }
  return `${lines.join("\n")}\n`
}

/** The files of the project the page's first "Add it" command is for. */
const filesBefore = (addons: ReadonlyMap<string, LoadedAddon>, slot: SlotId, option: string) => {
  const from = addCommands(slot, option)[0]?.from
  return from === undefined
    ? Promise.resolve(new Set<string>())
    : run(generate(from, addons)).then((tree) => new Set(tree.keys()))
}

/** docs/addons path -> content, for every add-on but `base`. */
export const addonPages = async (
  addons: ReadonlyMap<string, LoadedAddon>,
): Promise<Map<string, string>> => {
  const loaded = [...addons.values()].filter((a) => a.manifest.id !== "base")
  const out = new Map<string, string>()
  for (const { manifest, dir } of loaded) {
    const [slot, option] = manifest.id.split("/") as [SlotId, string]
    const existing = await filesBefore(addons, slot, option)
    out.set(`${pagesDir}/${pageName(manifest.id)}`, page(manifest, dir, existing))
  }
  out.set(`${pagesDir}/README.md`, index(loaded.map((a) => a.manifest)))
  return out
}

if (import.meta.main) {
  const pages = await addonPages(await readAddons())
  const dir = join(root, pagesDir)
  mkdirSync(dir, { recursive: true })
  let changed = 0
  for (const file of readdirSync(dir))
    if (!pages.has(`${pagesDir}/${file}`)) {
      rmSync(join(dir, file))
      console.log(`removed ${pagesDir}/${file}`)
      changed++
    }
  for (const [path, body] of pages) {
    const file = join(root, path)
    if (existsSync(file) && readFileSync(file, "utf8") === body) continue
    writeFileSync(file, body)
    console.log(`wrote ${path}`)
    changed++
  }
  console.log(changed === 0 ? "add-on pages are up to date" : `${changed} file(s) changed`)
}
