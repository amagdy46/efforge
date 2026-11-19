import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { Context, Effect, Exit, Option, Path, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { parse as parseJsonc } from "jsonc-parser"
import pc from "picocolors"
import { addonIdsFor, type LoadedAddon, loadAddons } from "../addon.ts"
import {
  BIN,
  type Failure,
  internal,
  Invocation,
  printSuccess,
  report,
  typoOf,
} from "../contract.ts"
import { COMMIT, exec, FORMAT, has, INSTALL, INSTALL_ARGS } from "../exec.ts"
import { alternative, finish, fix, intentOf, meantName, withFlag } from "../fix.ts"
import { generate, matches } from "../generate.ts"
import { askStack, CUSTOM, DEFAULT_NAME, type StackFlags } from "../prompts/flow.ts"
import { type Preset, presetIds, presets } from "../presets.ts"
import { cancelled, PromptIO, type PromptIOShape } from "../prompts/navigable.ts"
import { projectDirName } from "../projectName.ts"
import { envGroups, localEnvFile } from "../env.ts"
import { planSteps, renderSteps, type Step } from "../readme.ts"

export type { Step } from "../readme.ts"
export { planSteps } from "../readme.ts"
import { introLine } from "../intro.ts"
import { generateRouteTree } from "../routeTree.ts"
import { slots } from "../slots.ts"
import { StackConfig, toCommand } from "../stack.ts"
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
  /** The dry run lists every file, not a summary by add-on. */
  readonly verbose?: boolean
  readonly json: boolean
  readonly install: boolean
  readonly git: boolean
}

/** The summary's title: says which preset, if one was used, filled the stack. */
const stackTitle = (preset: Preset | undefined): string =>
  preset === undefined ? "Your stack" : `Your stack (the ${preset.title} preset)`

const summary = (stack: StackConfig): string =>
  [
    `${pc.dim("name".padEnd(9))} ${stack.name}`,
    ...slots.map((s) => {
      const v = s.id === "extras" ? stack.extras.join(", ") : stack[s.id]
      return `${pc.dim(s.id.padEnd(9))} ${v === "" ? "none" : v}`
    }),
  ].join("\n")

/** Seconds since `start`, for the last line of a run. */
export const elapsed = (start: number): string =>
  `${((performance.now() - start) / 1000).toFixed(1)}s`

/** Label-value lines with the values in one column, each after the outro's own indent. */
export const outroLines = (
  first: string,
  rows: ReadonlyArray<readonly [string, string]>,
): string => {
  const width = Math.max(0, ...rows.map(([label]) => label.length))
  return [
    first,
    ...rows.map(([label, value]) => `   ${pc.dim(label.padEnd(width))}  ${value}`),
  ].join("\n")
}

/** Where each file comes from: the last add-on, in overlay order, that writes it; else `base`. */
export const origins = (
  stack: StackConfig,
  addons: ReadonlyMap<string, LoadedAddon>,
  files: ReadonlyArray<string>,
): Map<string, string> => {
  const from = new Map<string, string>()
  for (const id of addonIdsFor(stack)) {
    const m = addons.get(id)?.manifest
    for (const f of [...(m?.files ?? []), ...(m?.card?.files ?? [])])
      if (matches(f.when, stack) && !(f.ifAbsent === true && from.has(f.target)))
        from.set(f.target, id)
  }
  return new Map(files.map((f) => [f, from.get(f) ?? "base"]))
}

/** `apps/web/src/x.ts` -> `apps/web`, `README.md` -> `(root)`: the top two levels of a path. */
const topOf = (file: string): string => {
  const parts = file.split("/")
  return parts.length === 1 ? "(root)" : parts.slice(0, Math.min(2, parts.length - 1)).join("/")
}

/**
 * The files a dry run would write, by the add-on they come from: a count and the top-level
 * directories for each, or (`verbose`) every file under its add-on.
 */
export const filesByOrigin = (
  stack: StackConfig,
  addons: ReadonlyMap<string, LoadedAddon>,
  files: ReadonlyArray<string>,
  verbose: boolean,
): string => {
  const from = origins(stack, addons, files)
  const order = addonIdsFor(stack)
  const groups = order
    .map((id) => ({ id, files: files.filter((f) => from.get(f) === id) }))
    .filter((g) => g.files.length > 0)
  if (verbose)
    return groups
      .map((g) =>
        [pc.bold(`${g.id} (${g.files.length})`), ...g.files.map((f) => `  ${f}`)].join("\n"),
      )
      .join("\n\n")
  const width = Math.max(...groups.map((g) => g.id.length))
  const count = Math.max(...groups.map((g) => String(g.files.length).length)) + 1
  return [
    ...groups.map((g, i) => {
      const tops = new Map<string, number>()
      for (const f of g.files) tops.set(topOf(f), (tops.get(topOf(f)) ?? 0) + 1)
      const where = [...tops]
        .toSorted(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
        .map(([dir, n]) => `${dir} ${n}`)
        .join(", ")
      const n = `${i === 0 ? "" : "+"}${g.files.length}`.padStart(count)
      return `${g.id.padEnd(width)}  ${n}  ${pc.dim(where)}`
    }),
    "",
    pc.dim("Every file: add --verbose, or --json for the list as data."),
  ].join("\n")
}

/** --json: no chrome on stdout; warnings and skipped steps are kept for the document. */
const collectingIO = (io: PromptIOShape, warnings: string[]): PromptIOShape => ({
  ...io,
  intro: () => Effect.void,
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
  /** What a success would have reported: directory, stack, files, env, nextSteps. */
  partial: Schema.Unknown,
}) {}

/** What a create left behind when it stopped early, as the documents report it. */
export const leftBehind = (o: {
  readonly dir: string
  readonly stack: StackConfig
  readonly command: string
  readonly files: ReadonlyArray<string>
  readonly env: ReadonlyArray<EnvVar>
  readonly remaining: ReadonlyArray<string>
  readonly installRequested: boolean
  readonly warnings: ReadonlyArray<string>
}) => ({
  directory: o.dir,
  stack: o.stack,
  command: o.command,
  files: o.files,
  env: o.env,
  // the setup still owed, then what a finished create would have said
  nextSteps: [
    ...o.remaining.map((command) => ({ command })),
    ...planSteps(o.stack, { installed: o.installRequested }),
  ].map((s) => Object.assign({}, s, { cwd: o.dir })),
  warnings: o.warnings,
})

/** Node versions Vite+ supports; mirrors `engines` in package.json. */
const nodeSupported = (version: string): boolean => {
  const [major = 0, minor = 0] = version.replace(/^v/, "").split(".").map(Number)
  return (major === 24 && minor >= 11) || major >= 26
}

/** What to run after `create`, for this stack, as people read it: the README's "Run it", from the same source. */
export const nextSteps = (
  stack: StackConfig,
  o: {
    readonly dirName: string
    readonly inPlace: boolean
    readonly installed: boolean
  },
): string => {
  const steps: Step[] = [
    ...(o.inPlace ? [] : [{ command: `cd ${o.dirName}` }]),
    ...planSteps(stack, o),
  ]
  return renderSteps(steps)
    .map((line) => {
      const at = line.indexOf("  # ")
      return at === -1
        ? `  ${pc.cyan(line)}`
        : `  ${pc.cyan(line.slice(0, at))}${pc.dim(line.slice(at))}`
    })
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

/** Every env var of `stack`, in add-on order, as `create` leaves them. */
export const envFor = (stack: StackConfig, addons: ReadonlyMap<string, LoadedAddon>): EnvVar[] =>
  envGroups(stack, addons).flatMap((g) =>
    g.vars.map((v) => ({
      name: v.name,
      description: v.description,
      file: localEnvFile(stack),
      // efforge wrote a value that works locally; a real secret is written empty
      set: v.dev !== undefined,
    })),
  )

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
    const start = performance.now()

    if (!quiet) yield* io.intro(introLine())

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
    let preset: Preset | undefined
    const stack = yield* askStack(flags, io, {
      yes,
      onPreset: (p) => {
        preset = p
      },
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
    if (!opts.dryRun && isOccupied(dir)) {
      const project = existingProject(dir)
      return yield* new TargetNotEmpty(
        project === undefined ? { dir, requested: stack } : { dir, project, requested: stack },
      )
    }
    const addons = yield* loadAddons(templatesDir)
    const tree = yield* generate(stack, addons)
    const files = [...tree.keys()].toSorted()
    const env = envFor(stack, addons)

    const shownCommand = inPlace
      ? command.replace(` create ${stack.name} --yes`, " create . --yes")
      : command
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
              command: alternative(args, (i) => withFlag(i, "dry-run", null)) ?? command,
              cwd: process.cwd(),
              note: "create it for real",
            },
          ],
          warnings,
        })
      } else {
        yield* io.note(summary(stack), stackTitle(preset))
        yield* io.note(
          filesByOrigin(stack, addons, files, opts.verbose === true),
          `Would write ${files.length} files`,
        )
        yield* io.outro(
          outroLines(pc.dim("Dry run: nothing written."), [["Run it for real:", shownCommand]]),
        )
      }
      return
    }

    yield* io.note(summary(stack), stackTitle(preset))
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
      if (opts.install) remaining.push(INSTALL, FORMAT)
      if (gitReady) remaining.push(COMMIT)
      if (opts.install) {
        yield* io.task("Installing dependencies (pnpm install)", (log) =>
          exec("pnpm", [...INSTALL_ARGS], dir, log),
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
    const partial = () =>
      leftBehind({
        dir,
        stack,
        command,
        files,
        env,
        remaining,
        installRequested: opts.install,
        warnings,
      })
    yield* setup.pipe(
      Effect.catchTag("CommandFailed", (e) =>
        Effect.fail(
          new SetupIncomplete({
            dir,
            command: e.command,
            output: e.output,
            remaining: [...remaining],
            partial: partial(),
          }),
        ),
      ),
      Effect.onInterrupt(() =>
        opts.json
          ? interrupted({ args, written, dir, remaining, partial: partial() })
          : io.warn(
              !written
                ? `Stopped while writing files. Delete ${inPlace ? "what was written here" : `./${dirName}`} and run the same command again.`
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
      outroLines(`${pc.green("Done")} in ${elapsed(start)}.`, [
        ["Add more later:", `${BIN} list${inPlace ? "" : ` --cwd ${dirName}`}`],
        ["Same stack again:", command],
      ]),
    )
  })

/**
 * Under --json, an interrupted create (Ctrl-C, SIGTERM, a tool's timeout) still prints its one
 * document: what was written and the steps that finish the job. The exit code stays 130.
 */
const interrupted = (o: {
  readonly args: ReadonlyArray<string>
  readonly written: boolean
  readonly dir: string
  readonly remaining: ReadonlyArray<string>
  readonly partial: ReturnType<typeof leftBehind>
}) =>
  Effect.gen(function* () {
    const rel = relative(process.cwd(), o.dir) || "."
    const failure: Failure = !o.written
      ? {
          code: "Interrupted",
          message: `Stopped while writing files. Delete ${rel} and run the same command again.`,
          fix: null,
          details: { directory: o.dir, written: false, remaining: [] },
        }
      : {
          code: "Interrupted",
          message:
            o.remaining.length === 0
              ? `Stopped after the setup; ${rel} is ready.`
              : `Stopped. ${rel} is only partly set up; to finish, run there: ${o.remaining.join(", then ")}`,
          fix: finish(o.args, o.dir, o.remaining),
          details: { written: true, remaining: o.remaining, ...o.partial },
        }
    yield* report(true, failure)
    yield* Effect.sync(() => {
      process.exitCode = 130
    })
  })

/**
 * `dir` holds an efforge project (an earlier, maybe interrupted, create): its stack, and which
 * setup steps never ran. Undefined when there is no readable efforge.jsonc.
 */
export const existingProject = (
  dir: string,
): { stack: StackConfig; remaining: string[] } | undefined => {
  let text: string
  try {
    text = readFileSync(join(dir, "efforge.jsonc"), "utf8")
  } catch {
    return undefined
  }
  const stack = Schema.decodeUnknownOption(StackConfig)(
    (parseJsonc(text) as { stack?: unknown } | undefined)?.stack,
  )
  if (Option.isNone(stack)) return undefined
  const installed = existsSync(join(dir, "node_modules", ".modules.yaml"))
  let uncommitted = false
  if (existsSync(join(dir, ".git")))
    try {
      execFileSync("git", ["rev-parse", "--verify", "-q", "HEAD"], { cwd: dir, stdio: "ignore" })
    } catch {
      uncommitted = true
    }
  return {
    stack: stack.value,
    remaining: [...(installed ? [] : [INSTALL, FORMAT]), ...(uncommitted ? [COMMIT] : [])],
  }
}

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
  preset: Flag.Literals("preset", presetIds).pipe(
    Flag.withDescription("Start from a preset (list shows them); a stack flag overrides its slot"),
    Flag.optional,
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
    Flag.withDescription("Print the files that would be written, by add-on; write nothing"),
    Flag.withDefault(false),
  ),
  verbose: Flag.Boolean("verbose").pipe(
    Flag.withDescription("With --dry-run, list every file"),
    Flag.withDefault(false),
  ),
  json: Flag.Boolean("json").pipe(
    Flag.withDescription(
      "Print one JSON document on stdout, nothing else (implies --yes; https://github.com/amagdy46/efforge/blob/main/docs/json.md)",
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
  preset: Option.Option<string>
  runtime: Option.Option<string>
  database: Option.Option<string>
  orm: Option.Option<string>
  auth: Option.Option<string>
  infra: Option.Option<string>
  ai: Option.Option<string>
  extras: Option.Option<string>
  yes: boolean
  dryRun: boolean
  verbose: boolean
  json: boolean
  install: boolean
  git: boolean
}): CreateOptions => ({
  flags: {
    name: opt(input.name),
    preset: opt(input.preset),
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
  verbose: input.verbose,
  json: input.json,
  install: input.install,
  git: input.git,
})

// --- Errors ----------------------------------------------------------------------

const resolves = (flags: StackFlags): boolean =>
  Exit.isSuccess(Effect.runSyncExit(askStack(flags, {} as PromptIOShape, { yes: true })))

/** One way out of a conflict: a complete command, and what it changes. */
export interface Alternative {
  readonly command: string
  readonly description: string
}

/**
 * Every one-flag change of `flags` that resolves a conflict on `slot`: another value of any slot,
 * or `value` left out of `--extras`. None of them is a `fix`, since each drops or swaps a choice.
 */
const waysOut = (
  args: ReadonlyArray<string>,
  flags: StackFlags,
  slot: string,
  value: string,
): Alternative[] => {
  const out: Alternative[] = []
  const add = (name: string, to: string, description: string) => {
    const command = alternative(args, (i) => withFlag(i, name, to))
    if (command !== null) out.push({ command, description })
  }
  for (const s of slots) {
    if (s.options.length <= 1) continue
    if (s.id === "extras") {
      const rest = (flags.extras ?? []).filter((x) => x !== value)
      if (slot === "extras" && resolves({ ...flags, extras: rest }))
        add("extras", rest.join(","), `Leave ${value} out of --extras`)
      continue
    }
    const current = flags[s.id]
    for (const o of s.options) {
      if (o.id === current || !resolves({ ...flags, [s.id]: o.id })) continue
      add(
        s.id,
        o.id,
        current === undefined
          ? `Use --${s.id}=${o.id}`
          : `Use --${s.id}=${o.id} instead of --${s.id}=${current}`,
      )
    }
  }
  return out
}

const sameStack = (a: StackConfig, b: StackConfig): boolean =>
  JSON.stringify({ ...a, extras: a.extras.toSorted() }) ===
  JSON.stringify({ ...b, extras: b.extras.toSorted() })

/** What went wrong in `create`, as the contract reports it. */
export const createFailure = (
  e: { readonly _tag: string; readonly message?: string } & Record<string, unknown>,
  args: ReadonlyArray<string>,
  flags: StackFlags,
): Failure => {
  switch (e._tag) {
    case "IncompatibleStack": {
      const slot = String(e.slot)
      const value = String(e.value)
      const allowed = e.allowed as string[]
      const def = slots.find((x) => x.id === slot)
      const known = def?.options.some((o) => o.id === value) ?? false
      if (known) {
        // two choices that can't go together: which one gives way is the caller's to say
        const alternatives = waysOut(args, flags, slot, value)
        return {
          code: "IncompatibleStack",
          message: `--${slot}=${value} can't be used here${typeof e.reason === "string" ? `: ${e.reason}.` : `. Options: ${allowed.join(", ")}.`} Change one of the two; alternatives lists the commands.`,
          fix: null,
          details: {
            flag: `--${slot}`,
            value,
            allowed,
            ...(typeof e.reason === "string" ? { reason: e.reason } : {}),
            alternatives,
          },
          more: alternatives.map((a) => `  ${a.command}  # ${a.description}`).join("\n"),
        }
      }
      // an unknown value gets a fix only when it is a clear typo of one allowed value (the typo
      // rule in contract.ts); never a different choice
      const near = typoOf(value, allowed)
      const to =
        near === undefined
          ? undefined
          : slot === "extras"
            ? [...new Set((flags.extras ?? []).map((x) => (x === value ? near : x)))].join(",")
            : near
      const fixed = to === undefined ? null : fix(args, (i) => withFlag(i, slot, to))
      return {
        code: "UnknownValue",
        message: `Unknown --${slot}=${value}. Options: ${allowed.join(", ")}.${fixed === null ? " It isn't a clear typo of any of them, so there is no fix; efforge offers nothing else here." : ""}`,
        fix: fixed,
        details: { flag: `--${slot}`, value, allowed },
      }
    }
    case "UnknownPreset": {
      const value = String(e.value)
      const near = typoOf(value, presetIds)
      const fixed = near === undefined ? null : fix(args, (i) => withFlag(i, "preset", near))
      return {
        code: "UnknownValue",
        message: `Unknown --preset=${value}. Presets: ${presets.map((p) => `${p.id} (${p.description})`).join("; ")}.${fixed === null ? " It isn't a clear typo of any of them, so there is no fix." : ""}`,
        fix: fixed,
        details: { flag: "--preset", value, allowed: [...presetIds] },
      }
    }
    case "InvalidProjectName": {
      const name = String(e.name)
      // only case and spaces are changed (`My App`): a path or other characters mean a choice
      const meant = meantName(name)
      return {
        code: "InvalidProjectName",
        message: `${String(e.message)}.${meant === undefined ? "" : ` Did you mean ${meant}?`}`,
        fix:
          meant === undefined
            ? null
            : fix(args, (i) => ({ ...i, operands: [meant, ...i.operands.slice(1)] })),
        details: { name, ...(meant === undefined ? {} : { suggestion: meant }) },
      }
    }
    case "TargetNotEmpty": {
      // never a renamed project: a retry after a timeout would leave two
      const dir = String(e.dir)
      const project = e.project as { stack: StackConfig; remaining: string[] } | undefined
      const requested = e.requested as StackConfig | undefined
      if (project === undefined)
        return {
          code: "TargetNotEmpty",
          message: `${dir} already exists and isn't empty. Pick another name or remove it.`,
          fix: null,
          details: { directory: dir, project: false },
        }
      const rest = project.remaining
      const steps = [
        ...rest.map((command) => ({ command })),
        ...planSteps(project.stack, { installed: true }),
      ].map((x) => Object.assign({}, x, { cwd: dir }))
      // only the project this command would have made is finished; anything else is a choice
      const same = requested !== undefined && sameStack(project.stack, requested)
      const finishing = same ? finish(args, dir, rest) : null
      return {
        code: "TargetNotEmpty",
        message: !same
          ? `${dir} already holds an efforge project (${project.stack.name}) with a different stack from the one asked for (stack is what it has, requested what this command asked for). Pick another name, or use that project as it is.`
          : finishing !== null
            ? `${dir} already holds an efforge project with this stack, and its setup didn't finish. To finish it, run there: ${rest.join(", then ")}. Or pick another name.`
            : rest.length > 0
              ? `${dir} already holds an efforge project with this stack; the setup it still lacks (${rest.join(", then ")}) is what this command was told to skip.`
              : `${dir} already holds an efforge project with this stack. Use it (see nextSteps), or pick another name.`,
        fix: finishing,
        details: {
          directory: dir,
          project: true,
          stack: project.stack,
          ...(requested === undefined ? {} : { requested }),
          remaining: rest,
          nextSteps: steps,
        },
      }
    }
    case "NeedsInput": {
      const id = String(e.id)
      // "choose each part" is the stack flags, not a value of --preset
      const options = (e.options as string[]).filter((o) => !(id === "preset" && o === CUSTOM))
      const flag = id === "name" ? "<name>" : id === "confirm" ? "--yes" : `--${id}`
      return {
        code: "NeedsInput",
        message: `No terminal to ask for "${id}": ${flagHint(id, options)}, or --yes to accept the defaults.`,
        fix: fix(args, (i) => withFlag(i, "yes", true)),
        details: { prompt: id, flag, allowed: options },
      }
    }
    case "PnpmMissing": {
      const again = fix(args, (i) => i, { again: true })
      return {
        code: "PnpmMissing",
        message:
          "efforge projects use pnpm, and it isn't on your PATH. Install it (npm install --global pnpm, or https://pnpm.io/installation) and re-run, or pass --no-install.",
        fix: again === null ? null : `npm install --global pnpm && ${again}`,
      }
    }
    case "SetupIncomplete": {
      const rest = e.remaining as string[]
      const dir = String(e.dir)
      const output = String(e.output).trim().split("\n").slice(-15).join("\n")
      return {
        code: "SetupIncomplete",
        message: `\`${String(e.command)}\` failed. The files are in ${dir}${rest.length > 0 ? `; to finish, run there: ${rest.join(", then ")}` : "."}`,
        fix: finish(args, dir, rest),
        details: {
          failed: String(e.command),
          remaining: rest,
          output,
          ...(e.partial as object),
        },
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
    : id === "preset"
      ? `pass --preset=${options.join("|")} or the stack flags`
      : id === "confirm"
        ? "pass --yes to create without confirming"
        : `pass --${id}=${options.join("|")}${id === "extras" ? " (comma-separated, or --extras= for none)" : ""}`

/**
 * An unknown `--preset`, as `create` reports it (`UnknownValue`, with the typo fix), checked before
 * the arguments are parsed: the flag takes only the presets, so the parser would say less.
 */
export const presetFailure = (args: ReadonlyArray<string>): Failure | undefined => {
  const i = intentOf(args)
  if (i.verb !== "create") return undefined
  const flag = i.flags.find((f) => f.name === "preset")
  if (typeof flag?.value !== "string" || flag.value === "" || presetIds.includes(flag.value))
    return undefined
  const value = flag.value
  return createFailure(
    { _tag: "UnknownPreset", value, allowed: [...presetIds] },
    args,
    toCreateOptions({
      name: Option.none(),
      preset: Option.some(value),
      runtime: Option.none(),
      database: Option.none(),
      orm: Option.none(),
      auth: Option.none(),
      infra: Option.none(),
      ai: Option.none(),
      extras: Option.none(),
      yes: false,
      dryRun: false,
      verbose: false,
      json: false,
      install: true,
      git: true,
    }).flags,
  )
}

/** Command handler: one clear error and exit code 1; cancelling exits 130 like any Ctrl-C. */
export const createHandler = (input: Parameters<typeof toCreateOptions>[0]) => {
  const opts = toCreateOptions(input)
  return create(opts).pipe(
    Effect.catch((e) =>
      Effect.gen(function* () {
        if (e._tag === "Cancelled") return yield* cancelled
        const args = yield* Invocation
        yield* report(input.json, createFailure(e as never, args, opts.flags))
      }),
    ),
  )
}

export const createCommand = Command.make("create", createConfig, createHandler).pipe(
  Command.withDescription("Create a new app"),
)
