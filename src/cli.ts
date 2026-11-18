import { Console, Effect, Stdio } from "effect"
import { type CliError, Command } from "effect/cli"
import pc from "picocolors"
import { addCommand } from "./commands/add.ts"
import { createCommand, createConfig, createHandler } from "./commands/create.ts"
import { listCommand } from "./commands/list.ts"
import { efforgeVersion } from "./versions.ts"

/** Root behaves as `create`; `efforge create` is an explicit alias, `add` and `list` are separate. */
export const root = Command.make("create-efforge", createConfig, createHandler).pipe(
  Command.withDescription(
    "Scaffold an Effect + TanStack Start app on Cloudflare with database, auth and services already wired together",
  ),
  Command.withSubcommands([createCommand, addCommand, listCommand]),
  Command.withExamples([
    {
      command: "npm create efforge my-app",
      description: "Answer a few questions, then create ./my-app",
    },
    {
      command: "npm create efforge my-app -- --yes --database=d1 --orm=effect-sql",
      description: "No questions: flags, defaults for the rest",
    },
    {
      command: "npm create efforge . -- --yes",
      description: "Create in the current (empty) directory",
    },
    { command: "npx create-efforge list", description: "See every add-on" },
    {
      command: "npx create-efforge add email storage",
      description: "Add add-ons to an existing project",
    },
  ]),
)

// --- Parse errors ----------------------------------------------------------------
// Effect's runner prints the whole help on stdout for a mistyped flag, which breaks --json and
// buries the one line that matters. So the arguments are parsed first by the same command tree
// with handlers that do nothing and a console that prints nothing; only if that parse succeeds
// does the real command run.

const noop = () => {}
const silent = new Proxy({} as Console.Console, { get: () => noop })

const probe = Command.make("create-efforge", createConfig).pipe(
  Command.withSubcommands([
    Command.withHandler(createCommand, () => Effect.void),
    Command.withHandler(addCommand, () => Effect.void),
    Command.withHandler(listCommand, () => Effect.void),
  ]),
)

const didYouMean = (suggestions: ReadonlyArray<string>) =>
  suggestions.length === 0 ? "" : ` Did you mean ${suggestions.join(" or ")}?`

/** One line per parse error, with the closest valid flag when there is one. */
export const describeParseError = (e: CliError.NonShowHelpErrors): string => {
  switch (e._tag) {
    case "UnrecognizedOption":
      return `Unknown flag ${e.option}.${didYouMean(e.suggestions)}`
    case "UnknownSubcommand":
      return `Unknown command ${e.subcommand}.${didYouMean(e.suggestions)}`
    case "MissingArgument":
      return e.argument === "ids"
        ? "Name the add-ons to add, for example: create-efforge add email. See them all with create-efforge list."
        : `${e.message}.`
    default:
      return e.message.endsWith(".") ? e.message : `${e.message}.`
  }
}

/** `--json` anywhere before `--`, unless it is explicitly turned off. */
const wantsJson = (args: ReadonlyArray<string>): boolean => {
  const end = args.indexOf("--")
  return (end === -1 ? args : args.slice(0, end)).some(
    (a) => a === "--json" || /^--json=(?:true|yes|on|1|y)$/i.test(a),
  )
}

const reportParseError = (args: ReadonlyArray<string>, error: CliError.ShowHelp) =>
  Effect.gen(function* () {
    yield* Effect.sync(() => {
      process.exitCode = 1
    })
    const help = `Run ${error.commandPath.join(" ")} --help to see every flag.`
    const lines = error.errors.map(describeParseError)
    if (wantsJson(args))
      return yield* Console.log(
        JSON.stringify(
          {
            error: {
              code: error.errors[0]?._tag ?? "InvalidArguments",
              message: `${lines.join(" ")} ${help}`,
            },
          },
          null,
          2,
        ),
      )
    yield* Console.error(`${pc.red(lines.join("\n"))}\n${pc.dim(help)}`)
  })

const runRoot = Command.runWith(root, { version: efforgeVersion })
const runProbe = Command.runWith(probe, { version: efforgeVersion, renderErrors: false })

/** Runs the CLI with explicit arguments (the entry point reads them from Stdio; tests pass them). */
export const runWith = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    // the wizard prompts, so it can't be dry-parsed; it reports its own errors
    if (!args.some((a) => a === "--wizard" || a.startsWith("--wizard="))) {
      const invalid = yield* runProbe(args).pipe(
        Effect.provideService(Console.Console, silent),
        Effect.as(undefined),
        Effect.catch((e) =>
          Effect.succeed(e._tag === "ShowHelp" && e.errors.length > 0 ? e : undefined),
        ),
      )
      if (invalid !== undefined) return yield* reportParseError(args, invalid)
    }
    return yield* runRoot(args)
  })

export const main = Stdio.Stdio.use(({ args }) => Effect.flatMap(args, runWith))
