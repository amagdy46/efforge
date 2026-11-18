import { readdirSync } from "node:fs"
import { basename, relative, resolve } from "node:path"
import { Context, Effect, Option, Path, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import pc from "picocolors"
import { addonIdsFor, type LoadedAddon, loadAddons } from "../addon.ts"
import {
  closest,
  commandLine,
  dropFlag,
  type Failure,
  inDir,
  insertAt,
  internal,
  Invocation,
  positionals,
  printSuccess,
  replaceAt,
  report,
  setFlag,
} from "../contract.ts"
import { exec, has } from "../exec.ts"
import { generate, matches } from "../generate.ts"
import { askStack, DEFAULT_NAME, type StackFlags } from "../prompts/flow.ts"
import { PromptIO, type PromptIOShape } from "../prompts/navigable.ts"
import { projectDirName } from "../projectName.ts"
import { generateRouteTree } from "../routeTree.ts"
import { slots } from "../slots.ts"
import { type StackConfig, toCommand } from "../stack.ts"
import { templatesDir as packageTemplatesDir } from "../versions.ts"
import { TargetNotEmpty, writeTree } from "../write.ts"

/** The package's `templates/` dir. */
export const defaultTemplatesDir: string = packageTemplatesDir

/** Where add-on templates live; tests point it at fixtures. */
export const TemplatesDir = Context.Reference<string>("efforge/TemplatesDir", {
  defaultValue: () => defaultTemplatesDir,
})

export interface CreateOptions {
  readonly flags: StackFlags
  readonly yes: boolean
  readonly dryRun: boolean
  readonly json: boolean
  readonly install: boolean
  readonly git: boolean
}

const summary = (stack: StackConfig): string =>
  [
    `${pc.dim("name".padEnd(9))} ${stack.name}`,
    ...slots.map((s) => {
      const v = s.id === "extras" ? stack.extras.join(", ") : stack[s.id]
      return `${pc.dim(s.id.padEnd(9))} ${v === "" ? "none" : v}`
    }),
  ].join("\n")

/** --json: no chrome on stdout; warnings and skipped steps are kept for the document. */
const collectingIO = (io: PromptIOShape, warnings: string[]): PromptIOShape => ({
  ...io,
  intro: () => Effect.void,
  section: () => Effect.void,
  info: (m) => Effect.sync(() => void warnings.push(m)),
  warn: (m) => Effect.sync(() => void warnings.push(m)),
  note: () => Effect.void,
  outro: () => Effect.void,
  step: (_label, eff) => eff,
  task: (_label, eff) => eff(() => {}),
})

/** Files `vp fmt` can format; the lockfile and dotfiles like .gitignore are left alone. */
const formattable = /\.(?:tsx?|jsx?|json|jsonc|css|md)$/

/** pnpm is required; checked before any prompt so nobody answers everything and then fails. */
export class PnpmMissing extends Schema.TaggedError<PnpmMissing>()("PnpmMissing", {}) {}

/** A post-write step failed: the files are on disk, `remaining` finishes the setup by hand. */
export class SetupIncomplete extends Schema.TaggedError<SetupIncomplete>()("SetupIncomplete", {
  dir: Schema.String,
  command: Schema.String,
  output: Schema.String,
  remaining: Schema.Array(Schema.String),
}) {}

/** Node versions Vite+ supports; mirrors `engines` in package.json. */
const nodeSupported = (version: string): boolean => {
  const [major = 0, minor = 0] = version.replace(/^v/, "").split(".").map(Number)
  return (major === 24 && minor >= 11) || major >= 26
}

/** One command to run after `create` or `add`, inside the project directory. */
export interface Step {
  readonly command: string
  readonly note?: string
  /** Runs until stopped (a dev server): start it in the background, don't wait for it. */
  readonly longRunning?: boolean
}

/** What to run after `create`, for this stack, inside the project directory. */
export const planSteps = (stack: StackConfig, o: { readonly installed: boolean }): Step[] => {
  const steps: Step[] = []
  if (!o.installed) steps.push({ command: "pnpm install" })
  if (stack.infra === "alchemy") {
    steps.push({ command: "cp .env.example .env", note: "local values for Alchemy" })
    // D1 migrations still need wrangler.jsonc under Alchemy (a known gap, docs/limits.md)
    if (stack.database === "postgres") {
      steps.push({ command: "docker compose up -d --wait", note: "local Postgres" })
      steps.push({ command: "pnpm db:migrate" })
    }
    steps.push({
      command: "pnpm dev",
      note: "alchemy dev; deploying: see infra/README.md",
      longRunning: true,
    })
  } else {
    if (stack.database === "postgres")
      steps.push({ command: "docker compose up -d --wait", note: "local Postgres" })
    if (stack.database !== "none")
      steps.push(
        stack.database === "d1"
          ? { command: "pnpm db:migrate", note: "local D1" }
          : { command: "pnpm db:migrate" },
      )
    steps.push({ command: "pnpm dev", note: "http://localhost:5173", longRunning: true })
  }
  return steps
}

/** What to run after `create`, for this stack, as people read it. */
export const nextSteps = (
  stack: StackConfig,
  o: { readonly dirName: string; readonly inPlace: boolean; readonly installed: boolean },
): string => {
  const steps: Step[] = [
    ...(o.inPlace ? [] : [{ command: `cd ${o.dirName}` }]),
    ...planSteps(stack, o),
  ]
  const width = Math.max(...steps.map((s) => s.command.length))
  return steps
    .map(
      ({ command: c, note }) =>
        `  ${pc.cyan(c)}${note === undefined ? "" : `  ${" ".repeat(width - c.length)}${pc.dim(`# ${note}`)}`}`,
    )
    .join("\n")
}

/** An env var the project reads, and where its local value lives. */
export interface EnvVar {
  readonly name: string
  readonly description: string
  /** The file the local value is read from: `.dev.vars`, or `.env` with Alchemy. */
  readonly file: string
  /** efforge already wrote a local value there; false means fill it in before it is used. */
  readonly set: boolean
}

export const localEnvFile = (stack: StackConfig): string =>
  stack.infra === "alchemy" ? ".env" : ".dev.vars"

/** True when `text` (a .dev.vars or .env file) assigns `name`. */
export const assigns = (text: string | undefined, name: string): boolean =>
  text !== undefined && text.split("\n").some((l) => l.trimStart().startsWith(`${name}=`))

/** Every env var of `stack`, in add-on order, as `create` leaves them. */
export const envFor = (
  stack: StackConfig,
  addons: ReadonlyMap<string, LoadedAddon>,
  tree: ReadonlyMap<string, string>,
): EnvVar[] => {
  const file = localEnvFile(stack)
  const seen = new Set<string>()
  const out: EnvVar[] = []
  for (const id of addonIdsFor(stack))
    for (const v of addons.get(id)?.manifest.envVars ?? []) {
      if (!matches(v.when, stack) || seen.has(v.name)) continue
      seen.add(v.name)
      out.push({
        name: v.name,
        description: v.description,
        file,
        set: assigns(tree.get(file), v.name),
      })
    }
  return out
}

/** validate -> generate -> (dry-run | write -> git init -> pnpm install -> route tree -> format -> commit). */
export const create = (opts: CreateOptions) =>
  Effect.gen(function* () {
    const live = yield* PromptIO
    const path = yield* Path.Path
    const templatesDir = yield* TemplatesDir
    const args = yield* Invocation
    // --json must keep stdout machine-readable: it never prompts and prints no chrome. Warnings
    // and skipped steps are collected into the document instead.
    const quiet = opts.json
    const yes = opts.yes || opts.json
    const warnings: string[] = []
    const io: PromptIOShape = quiet ? collectingIO(live, warnings) : live

    if (!quiet)
      yield* io.intro(
        `${pc.bgCyan(pc.black(" efforge "))}${pc.dim("  Effect apps on Cloudflare, already wired")}`,
      )

    // `.` scaffolds into the current directory, named after it.
    const inPlace = opts.flags.name === "."
    const flags = inPlace ? { ...opts.flags, name: path.basename(process.cwd()) } : opts.flags

    let git = opts.git
    if (!opts.dryRun) {
      if (!nodeSupported(process.version))
        yield* io.warn(
          `Node ${process.version} isn't supported by the generated project (Vite+ needs Node 24.11+ or 26+).`,
        )
      if (opts.install && !(yield* has("pnpm"))) return yield* new PnpmMissing()
      if (git && !(yield* has("git"))) {
        yield* io.warn("git isn't installed: skipping git init and the initial commit.")
        git = false
      }
    }

    const targetFor = (name: string) =>
      inPlace ? process.cwd() : path.resolve(projectDirName(name))
    const stack = yield* askStack(flags, io, {
      yes,
      checkName: opts.dryRun
        ? undefined
        : (name) => {
            const dir = targetFor(name)
            return isOccupied(dir)
              ? `${path.relative(process.cwd(), dir) || "."} already exists and isn't empty; pick another name`
              : undefined
          },
    })
    const command = toCommand(stack)
    const dirName = projectDirName(stack.name)
    const dir = targetFor(stack.name)
    // Fail before generating (and before the confirm prompt) rather than after the user answered everything.
    if (!opts.dryRun && isOccupied(dir)) return yield* new TargetNotEmpty({ dir })
    const addons = yield* loadAddons(templatesDir)
    const tree = yield* generate(stack, addons)
    const files = [...tree.keys()].toSorted()
    const env = envFor(stack, addons, tree)

    const shownCommand = inPlace ? command.replace(` ${stack.name} --`, " . --") : command
    if (opts.dryRun) {
      if (isOccupied(dir))
        yield* io.warn(
          `${inPlace ? "This directory" : `./${dirName}`} isn't empty, so a real run would stop here.`,
        )
      if (opts.json) {
        return yield* printSuccess({
          dryRun: true,
          directory: dir,
          stack,
          command,
          files,
          installed: false,
          git: "skipped",
          env,
          nextSteps: [
            {
              command: commandLine(dropFlag(args, "dry-run")),
              cwd: process.cwd(),
              note: "create it for real",
            },
          ],
          warnings,
        })
      } else {
        yield* io.note(summary(stack), "Your stack")
        yield* io.note(files.join("\n"), `${files.length} files`)
        yield* io.outro(
          `${pc.dim("dry run: nothing written.")} Run it for real:\n  ${shownCommand}`,
        )
      }
      return
    }

    yield* io.note(summary(stack), "Your stack")
    if (!yes) {
      const ok = yield* io.confirm({
        id: "confirm",
        message: `Create it in ${inPlace ? "this directory" : `./${dirName}`}?`,
        initial: true,
      })
      if (ok !== true) {
        yield* io.outro("Nothing written.")
        return
      }
    }

    const remaining: string[] = []
    let written = false
    let gitState: "skipped" | "initialized" | "committed" = "skipped"
    const setup = Effect.gen(function* () {
      yield* io.step(`Writing ${files.length} files`, writeTree(dir, tree))
      written = true
      // Init before formatting: oxfmt honors .gitignore files up the directory tree, so a project
      // outside any repo would otherwise pick up a parent's ignore rules (a `*` hides every file).
      // A failure here must not fail the scaffold.
      const gitReady = git
        ? yield* io.step("Initializing git", exec("git", ["init"], dir)).pipe(
            Effect.as(true),
            Effect.catchTag("CommandFailed", (e) =>
              io
                .info(
                  `git setup skipped: ${e.command} failed. ${e.output.trim().split("\n")[0] ?? ""}`,
                )
                .pipe(Effect.as(false)),
            ),
          )
        : false
      if (gitReady) gitState = "initialized"
      if (opts.install) remaining.push("pnpm install", "pnpm format")
      if (gitReady) remaining.push("git add -A && git commit -m 'Initial commit'")
      if (opts.install) {
        yield* io.task("Installing dependencies (pnpm install)", (log) =>
          exec("pnpm", ["install"], dir, log),
        )
        remaining.shift()
        // routeTree.gen.ts isn't committed to templates: write it now, so typecheck and format see it.
        yield* io
          .step("Generating the route tree", generateRouteTree(dir))
          .pipe(
            Effect.catchTag("CommandFailed", (e) =>
              io.info(
                `route tree skipped: ${e.command} failed. ${e.output.trim().split("\n")[0] ?? ""}; \`pnpm typecheck\` regenerates it`,
              ),
            ),
          )
        // Transforms insert code and bindings unformatted, so tidy them now: the first `pnpm check`
        // passes. Without a repo of its own, a parent repo's ignore rules could hide every file, so
        // name the files: explicit paths bypass ignore files. Anything oxfmt can't fix is the user's to see.
        const targets = gitReady ? [] : files.filter((f) => formattable.test(f))
        yield* io
          .step("Formatting", exec("pnpm", ["format", ...targets], dir))
          .pipe(Effect.catchTag("CommandFailed", () => Effect.void))
        remaining.shift()
      }
      if (gitReady) {
        // Plain commit: whatever identity git is configured with.
        yield* io
          .step(
            "Creating the initial commit",
            Effect.gen(function* () {
              yield* exec("git", ["add", "-A"], dir)
              yield* exec("git", ["commit", "-m", "Initial commit from efforge"], dir)
              gitState = "committed"
            }),
          )
          .pipe(
            Effect.catchTag("CommandFailed", (e) =>
              io.info(
                `git commit skipped: ${e.command} failed. ${e.output.trim().split("\n")[0] ?? ""}${/identity|user\.(name|email)/i.test(e.output) ? " Set git config user.name and user.email, then commit." : ""}`,
              ),
            ),
          )
        remaining.length = 0
      }
    })
    yield* setup.pipe(
      Effect.catchTag("CommandFailed", (e) =>
        Effect.fail(
          new SetupIncomplete({
            dir,
            command: e.command,
            output: e.output,
            remaining: [...remaining],
          }),
        ),
      ),
      Effect.onInterrupt(() =>
        io.warn(
          !written
            ? `Stopped while writing files. Delete ${inPlace ? "what was written here" : `./${dirName}`} and run efforge again.`
            : remaining.length === 0
              ? `Stopped. ./${dirName} is set up; only the last step was skipped.`
              : `Stopped. ./${dirName} is only partly set up: delete it, or finish with:\n  ${remaining.join("\n  ")}`,
        ),
      ),
    )

    if (opts.json)
      return yield* printSuccess({
        dryRun: false,
        directory: dir,
        stack,
        command,
        files,
        installed: opts.install,
        git: gitState,
        env,
        nextSteps: planSteps(stack, { installed: opts.install }).map((s) =>
          Object.assign({}, s, { cwd: dir }),
        ),
        warnings,
      })
    yield* io.note(nextSteps(stack, { dirName, inPlace, installed: opts.install }), "Next steps")
    yield* io.outro(
      `${pc.green("Done.")} ${pc.dim("Add more later:")} npx create-efforge list\n   ${pc.dim("Same stack again:")} ${command}`,
    )
  })

/** Exists and has something in it besides `.git` and OS clutter. */
export const isOccupied = (dir: string): boolean => {
  try {
    return readdirSync(dir).some((f) => !ignorable.has(f))
  } catch {
    return false
  }
}
const ignorable = new Set([".git", ".DS_Store", "Thumbs.db"])

// --- CLI -----------------------------------------------------------------------

const slotFlag = (id: (typeof slots)[number]["id"]) => {
  const slot = slots.find((s) => s.id === id) as (typeof slots)[number]
  return Flag.String(id).pipe(
    Flag.withDescription(
      `${slot.title}: ${slot.options.map((o) => o.id).join(" | ")}${slot.multi ? " (comma-separated)" : ""}`,
    ),
    Flag.optional,
  )
}

/** Shared by the root command and the explicit `create` subcommand. */
export const createConfig = {
  name: Argument.String("name").pipe(
    Argument.withDescription(`Project name and directory (default prompt: ${DEFAULT_NAME})`),
    Argument.optional,
  ),
  runtime: slotFlag("runtime"),
  database: slotFlag("database"),
  orm: slotFlag("orm"),
  auth: slotFlag("auth"),
  infra: slotFlag("infra"),
  ai: slotFlag("ai"),
  extras: slotFlag("extras"),
  yes: Flag.Boolean("yes").pipe(
    Flag.withAlias("y"),
    Flag.withDescription("Accept defaults for anything a flag didn't set"),
    Flag.withDefault(false),
  ),
  dryRun: Flag.Boolean("dry-run").pipe(
    Flag.withDescription("Print the files that would be written; write nothing"),
    Flag.withDefault(false),
  ),
  json: Flag.Boolean("json").pipe(
    Flag.withDescription(
      "Print one JSON document on stdout, nothing else (implies --yes; docs/json.md)",
    ),
    Flag.withDefault(false),
  ),
  install: Flag.Boolean("install").pipe(
    Flag.withDescription("Run pnpm install (--no-install to skip)"),
    Flag.withDefault(true),
  ),
  git: Flag.Boolean("git").pipe(
    Flag.withDescription("git init + initial commit (--no-git to skip)"),
    Flag.withDefault(true),
  ),
}

const opt = <A>(o: Option.Option<A>): A | undefined => Option.getOrUndefined(o)

export const toCreateOptions = (input: {
  name: Option.Option<string>
  runtime: Option.Option<string>
  database: Option.Option<string>
  orm: Option.Option<string>
  auth: Option.Option<string>
  infra: Option.Option<string>
  ai: Option.Option<string>
  extras: Option.Option<string>
  yes: boolean
  dryRun: boolean
  json: boolean
  install: boolean
  git: boolean
}): CreateOptions => ({
  flags: {
    name: opt(input.name),
    runtime: opt(input.runtime),
    database: opt(input.database),
    orm: opt(input.orm),
    auth: opt(input.auth),
    infra: opt(input.infra),
    ai: opt(input.ai),
    extras: Option.match(input.extras, {
      onNone: () => undefined,
      onSome: (s) =>
        s
          .split(",")
          .map((x) => x.trim())
          .filter((x) => x !== ""),
    }),
  },
  yes: input.yes,
  dryRun: input.dryRun,
  json: input.json,
  install: input.install,
  git: input.git,
})

// --- Errors ----------------------------------------------------------------------

/** Where the project name sits in `args` (after an explicit `create`), if it was given. */
const nameIndex = (args: ReadonlyArray<string>): number | undefined => {
  const pos = positionals(args)
  return (pos[0]?.[1] === "create" ? pos[1] : pos[0])?.[0]
}

/** `args` with the project name set to `name`. */
const withName = (args: ReadonlyArray<string>, name: string): string[] => {
  const i = nameIndex(args)
  if (i !== undefined) return replaceAt(args, i, name)
  const pos = positionals(args)
  return pos[0]?.[1] === "create" ? insertAt(args, pos[0][0] + 1, name) : [name, ...args]
}

/** A valid npm name close to what was typed: `My App` -> `my-app`, `apps/web` -> `web`. */
export const slugName = (raw: string): string => {
  const base = raw.startsWith("@") ? raw : (raw.split("/").findLast((p) => p !== "") ?? raw)
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9\-._~@/]+/g, "-")
    .replace(/\.\.+/g, ".")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
  if (slug === "" || slug.startsWith("@")) return DEFAULT_NAME
  return ["node_modules", "favicon.ico", "test", "tests", "src", "dist"].includes(slug)
    ? `${slug}-app`
    : slug.slice(0, 214)
}

/** `name-2`, `name-3`, ...: the first one whose directory is free. */
const freeName = (name: string): string => {
  for (let n = 2; ; n++) {
    const candidate = `${name}-${n}`
    if (!isOccupied(resolve(projectDirName(candidate)))) return candidate
  }
}

/** The value of `slot` that fixes a conflict: the slot default when allowed, else the first allowed. */
const fixValue = (slot: string, allowed: ReadonlyArray<string>): string | undefined => {
  const def = slots.find((s) => s.id === slot)?.default
  return typeof def === "string" && allowed.includes(def) ? def : allowed[0]
}

/** What went wrong in `create`, as the contract reports it. */
export const createFailure = (
  e: { readonly _tag: string; readonly message?: string } & Record<string, unknown>,
  args: ReadonlyArray<string>,
  flags: StackFlags,
): Failure => {
  const run = (a: ReadonlyArray<string>) => commandLine(a)
  switch (e._tag) {
    case "IncompatibleStack": {
      const slot = String(e.slot)
      const value = String(e.value)
      const allowed = e.allowed as string[]
      const def = slots.find((x) => x.id === slot)
      const known = def?.options.some((o) => o.id === value) ?? false
      let fix: string | null = null
      if (slot === "extras") {
        // one item of a comma-separated list: swap in the closest option, or drop it
        const near = known ? undefined : closest(value, allowed)
        const list = (flags.extras ?? []).flatMap((x) =>
          x === value ? (near === undefined ? [] : [near]) : [x],
        )
        fix = run(setFlag(args, "extras", [...new Set(list)].join(",")))
      } else {
        const to = (known ? undefined : closest(value, allowed)) ?? fixValue(slot, allowed)
        if (to !== undefined) fix = run(setFlag(args, slot, to))
      }
      return known
        ? {
            code: "IncompatibleStack",
            message: `--${slot}=${value} can't be used here${typeof e.reason === "string" ? `: ${e.reason}.` : `. Options: ${allowed.join(", ")}.`}`,
            fix,
            details: {
              flag: `--${slot}`,
              value,
              allowed,
              ...(typeof e.reason === "string" ? { reason: e.reason } : {}),
            },
          }
        : {
            code: "UnknownValue",
            message: `Unknown --${slot}=${value}. Options: ${allowed.join(", ")}.`,
            fix,
            details: { flag: `--${slot}`, value, allowed },
          }
    }
    case "InvalidProjectName": {
      const name = String(e.name)
      return {
        code: "InvalidProjectName",
        message: String(e.message),
        fix: run(withName(args, slugName(name))),
        details: { name },
      }
    }
    case "TargetNotEmpty": {
      const dir = String(e.dir)
      const taken =
        nameIndex(args) === undefined
          ? DEFAULT_NAME
          : flags.name === "."
            ? basename(dir)
            : (flags.name ?? DEFAULT_NAME)
      return {
        code: "TargetNotEmpty",
        message: `${dir} already exists and isn't empty. Pick another name or remove it.`,
        fix: run(withName(args, freeName(slugName(taken)))),
        details: { directory: dir },
      }
    }
    case "NeedsInput": {
      const id = String(e.id)
      const options = e.options as string[]
      const flag = id === "name" ? "<name>" : id === "confirm" ? "--yes" : `--${id}`
      return {
        code: "NeedsInput",
        message: `No terminal to ask for "${id}": ${flagHint(id, options)}, or --yes to accept the defaults.`,
        fix: run(setFlag(args, "yes")),
        details: { prompt: id, flag, allowed: options },
      }
    }
    case "PnpmMissing":
      return {
        code: "PnpmMissing",
        message:
          "efforge projects use pnpm, and it isn't on your PATH. Install it (npm install --global pnpm, or https://pnpm.io/installation) and re-run, or pass --no-install.",
        fix: `npm install --global pnpm && ${run(args)}`,
      }
    case "SetupIncomplete": {
      const rest = e.remaining as string[]
      const dir = String(e.dir)
      const output = String(e.output).trim().split("\n").slice(-15).join("\n")
      return {
        code: "SetupIncomplete",
        message: `\`${String(e.command)}\` failed. The files are in ${dir}${rest.length > 0 ? `; to finish, run there: ${rest.join(", then ")}` : "."}`,
        fix: rest.length > 0 ? inDir(relative(process.cwd(), dir), rest) : null,
        details: { directory: dir, failed: String(e.command), remaining: rest, output },
        more: output,
      }
    }
    case "WriteFailed":
      return {
        code: "WriteFailed",
        message: `Couldn't write ${String(e.dir)}: ${String(e.message)}`,
        fix: null,
        details: { directory: String(e.dir) },
      }
    default:
      return internal(e)
  }
}

const flagHint = (id: string, options: ReadonlyArray<string>): string =>
  id === "name"
    ? "pass a project name"
    : id === "confirm"
      ? "pass --yes to create without confirming"
      : `pass --${id}=${options.join("|")}${id === "extras" ? " (comma-separated, or --extras= for none)" : ""}`

/** Command handler: one clear error and exit code 1; cancelling exits 130 like any Ctrl-C. */
export const createHandler = (input: Parameters<typeof toCreateOptions>[0]) => {
  const opts = toCreateOptions(input)
  return create(opts).pipe(
    Effect.catch((e) =>
      Effect.gen(function* () {
        if (e._tag === "Cancelled") {
          const io = yield* PromptIO
          yield* Effect.sync(() => {
            process.exitCode = 130
          })
          return yield* io.outro("Cancelled. Nothing written.")
        }
        const args = yield* Invocation
        yield* report(input.json, createFailure(e as never, args, opts.flags))
      }),
    ),
  )
}

export const createCommand = Command.make("create", createConfig, createHandler).pipe(
  Command.withDescription("Create a new app"),
)
