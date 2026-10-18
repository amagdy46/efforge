import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Console, Context, Effect, Option, Path } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import pc from "picocolors"
import { loadAddons } from "../addon.ts"
import { exec } from "../exec.ts"
import { generate } from "../generate.ts"
import { askStack, DEFAULT_NAME, type StackFlags } from "../prompts/flow.ts"
import { PromptIO } from "../prompts/navigable.ts"
import { slots } from "../slots.ts"
import { type StackConfig, toCommand } from "../stack.ts"
import { writeTree } from "../write.ts"

/** The package's `templates/` dir, resolved relative to this module (same depth in `src/` and `dist/`). */
export const defaultTemplatesDir: string = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
)

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

/** validate -> generate -> (dry-run | write -> pnpm install -> git init + commit). */
export const create = (opts: CreateOptions) =>
  Effect.gen(function* () {
    const io = yield* PromptIO
    const path = yield* Path.Path
    const templatesDir = yield* TemplatesDir
    // --json must keep stdout machine-readable, so it never prompts.
    const quiet = opts.json
    const yes = opts.yes || opts.json

    if (!quiet)
      yield* io.intro(
        `${pc.bgCyan(pc.black(" create-efforge "))}${pc.dim("  opinionated, every part replaceable")}`,
      )

    const stack = yield* askStack(opts.flags, io, { yes })
    const command = toCommand(stack)
    const addons = yield* loadAddons(templatesDir)
    const tree = yield* generate(stack, addons)
    const files = [...tree.keys()].sort()

    if (opts.dryRun) {
      if (opts.json) {
        yield* Console.log(JSON.stringify({ stack, command, files }, null, 2))
      } else {
        yield* io.note(summary(stack), "Your stack")
        yield* Console.log(files.join("\n"))
        yield* io.outro(`${pc.dim("dry run: nothing written")}  ${command}`)
      }
      return
    }

    yield* io.note(
      `${summary(stack)}\n\n${pc.dim("re-run non-interactively:")}\n${command}`,
      "Your stack",
    )
    if (!yes) {
      const ok = yield* io.confirm({ id: "confirm", message: "Create it?", initial: true })
      if (ok !== true) {
        yield* io.outro("Nothing written.")
        return
      }
    }

    const dirName = stack.name.split("/").pop() ?? stack.name
    const dir = path.resolve(dirName)
    yield* io.step("Writing files", writeTree(dir, tree))
    if (opts.install) {
      yield* io.step("Installing dependencies (pnpm install)", exec("pnpm", ["install"], dir))
    }
    if (opts.git) {
      // Plain commit: whatever identity git is configured with. A failure here must not fail the scaffold.
      yield* io
        .step(
          "Initializing git",
          Effect.gen(function* () {
            yield* exec("git", ["init"], dir)
            yield* exec("git", ["add", "-A"], dir)
            yield* exec("git", ["commit", "-m", "Initial commit from efforge"], dir)
          }),
        )
        .pipe(
          Effect.catchTag("CommandFailed", (e) =>
            io.info(
              `git setup skipped: ${e.command} failed. ${e.output.trim().split("\n")[0] ?? ""}`,
            ),
          ),
        )
    }
    yield* io.outro(
      `${pc.green("Done.")}\n\n  cd ${dirName}\n  ${opts.install ? "" : "pnpm install\n  "}pnpm dev\n\n${pc.dim("Same stack later:")} ${command}`,
    )
  })

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
    Flag.withDescription("With --dry-run: print {stack, command, files} as JSON (implies --yes)"),
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

const describe = (
  e: { readonly _tag: string; readonly message?: string } & Record<string, unknown>,
): string => {
  switch (e._tag) {
    case "IncompatibleStack":
      return `--${String(e.slot)}=${String(e.value)} isn't available with the other choices. Options: ${(e.allowed as string[]).join(", ")}`
    case "TargetNotEmpty":
      return `${String(e.dir)} already exists and is not empty. Pick another name or remove it.`
    case "CommandFailed":
      return `\`${String(e.command)}\` failed. The project was written; run it yourself.\n${String(e.output).trim()}`
    default:
      return e.message ?? e._tag
  }
}

/** Command handler: reports failures as one clear line and exit code 1; cancelling exits 0. */
export const createHandler = (input: Parameters<typeof toCreateOptions>[0]) =>
  create(toCreateOptions(input)).pipe(
    Effect.catch((e) =>
      Effect.gen(function* () {
        const io = yield* PromptIO
        if (e._tag === "Cancelled") return yield* io.outro("Cancelled.")
        yield* Console.error(pc.red(describe(e as never)))
        yield* Effect.sync(() => {
          process.exitCode = 1
        })
      }),
    ),
  )

export const createCommand = Command.make("create", createConfig, createHandler).pipe(
  Command.withDescription("Create a new app"),
)
