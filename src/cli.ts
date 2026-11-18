import { Console, Effect, Stdio } from "effect"
import { type CliError, Command, Completions } from "effect/cli"
import {
  BIN,
  commandLine,
  dropAt,
  dropFlag,
  type ErrorCode,
  Invocation,
  positionals,
  replaceAt,
  report,
  setFlag,
} from "./contract.ts"
import { addCommand } from "./commands/add.ts"
import { createCommand, createConfig, createHandler } from "./commands/create.ts"
import { listCommand } from "./commands/list.ts"
import { slots } from "./slots.ts"
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

const slotIds = new Set<string>(slots.map((s) => s.id))
const booleanFlags = new Set(["yes", "dry-run", "json", "install", "git", "overwrite"])

/** The smallest edit of `args` that gets past `e`, or null. */
const parseFix = (args: ReadonlyArray<string>, e: CliError.NonShowHelpErrors): string[] | null => {
  switch (e._tag) {
    case "UnrecognizedOption": {
      const i = args.findIndex((t) => t === e.option || t.startsWith(`${e.option}=`))
      if (i < 0) return null
      const token = args[i] as string
      const value = token.includes("=") ? token.slice(token.indexOf("=") + 1) : undefined
      // `--name=foo`: the name is positional
      if (e.option === "--name" && value !== undefined) return [value, ...dropAt(args, i)]
      const [suggestion] = e.suggestions
      // no close flag, or the close flag is already there (`--jsn --json`): drop the typo
      if (
        suggestion === undefined ||
        args.some((t, j) => j !== i && (t === suggestion || t.startsWith(`${suggestion}=`)))
      )
        return dropAt(args, i)
      return replaceAt(args, i, value === undefined ? suggestion : `${suggestion}=${value}`)
    }
    case "InvalidValue": {
      if (e.kind !== "flag") return null
      if (slotIds.has(e.option)) {
        const def = slots.find((s) => s.id === e.option)?.default
        return setFlag(args, e.option, typeof def === "string" ? def : "")
      }
      if (booleanFlags.has(e.option)) return setFlag(args, e.option)
      return dropFlag(args, e.option)
    }
    case "UnexpectedArgument": {
      let out = [...args]
      for (const extra of e.arguments) {
        const at = out.lastIndexOf(extra)
        if (at >= 0) out = dropAt(out, at)
      }
      return out
    }
    default:
      return null
  }
}

const parseCode = (e: CliError.NonShowHelpErrors): ErrorCode =>
  e._tag === "UnrecognizedOption"
    ? "UnknownFlag"
    : e._tag === "InvalidValue"
      ? "InvalidFlagValue"
      : e._tag === "UnexpectedArgument"
        ? "UnexpectedArgument"
        : "InternalError"

const reportParseError = (args: ReadonlyArray<string>, error: CliError.ShowHelp) => {
  const [first] = error.errors
  const help = `Run ${[BIN, ...error.commandPath.slice(1)].join(" ")} --help to see every flag.`
  const fixed = first === undefined ? null : parseFix(args, first)
  return report(wantsJson(args), {
    code: first === undefined ? "InternalError" : parseCode(first),
    message: `${error.errors.map(describeParseError).join(" ")} ${help}`,
    fix: fixed === null ? null : commandLine(fixed),
    details:
      first?._tag === "UnrecognizedOption"
        ? { flag: first.option, suggestions: first.suggestions }
        : first?._tag === "InvalidValue"
          ? { flag: `--${first.option}`, value: first.value, expected: first.expected }
          : first?._tag === "UnexpectedArgument"
            ? { arguments: first.arguments }
            : {},
  })
}

// --- Mistyped commands -------------------------------------------------------------
// The root command takes a project name, so `create-efforge lst --json` would create a project
// called "lst". A first argument one deletion or one swap away from a command is refused instead.

const commands = ["create", "add", "list"]

const nearMiss = (typed: string, command: string): boolean => {
  if (typed === command || typed.length < 2) return false
  // one character dropped
  if (typed.length === command.length - 1)
    for (let i = 0; i < command.length; i++)
      if (command.slice(0, i) + command.slice(i + 1) === typed) return true
  // two neighbours swapped
  if (typed.length === command.length)
    for (let i = 0; i < command.length - 1; i++)
      if (
        command.slice(0, i) + (command[i + 1] ?? "") + (command[i] ?? "") + command.slice(i + 2) ===
        typed
      )
        return true
  return false
}

const mistypedCommand = (args: ReadonlyArray<string>) => {
  const [first] = positionals(args)
  if (first === undefined) return undefined
  const command = commands.find((c) => nearMiss(first[1], c))
  return command === undefined ? undefined : { at: first[0], typed: first[1], command }
}

// --- Completions -------------------------------------------------------------------
// Both bins (`create-efforge` and `efforge`) get completion from one script.

const completionShell = (args: ReadonlyArray<string>): string | undefined => {
  const i = args.findIndex((t) => t === "--completions" || t.startsWith("--completions="))
  if (i < 0) return undefined
  const t = args[i] as string
  const v = t.includes("=") ? t.slice(t.indexOf("=") + 1) : args[i + 1]
  return v === "sh" ? "bash" : v === "pwsh" ? "powershell" : v
}

export const completionScript = (shell: "bash" | "zsh" | "fish" | "powershell"): string => {
  const script = Completions.generate("create-efforge", shell, Completions.fromCommand(root))
  switch (shell) {
    case "bash":
      return script.replace(/^(complete -F (\S+) create-efforge)$/m, "$1\ncomplete -F $2 efforge")
    case "zsh":
      return script
        .replace(/^#compdef create-efforge$/m, "#compdef create-efforge efforge")
        .replace(/^(\s*compdef (\S+) create-efforge)$/m, "$1 efforge")
    case "fish":
      return `${script.trimEnd()}\ncomplete -c efforge --wraps create-efforge\n`
    case "powershell":
      return script
  }
}

const runRoot = Command.runWith(root, { version: efforgeVersion })
const runProbe = Command.runWith(probe, { version: efforgeVersion, renderErrors: false })

/** Runs the CLI with explicit arguments (the entry point reads them from Stdio; tests pass them). */
export const runWith = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const shell = completionShell(args)
    if (shell === "bash" || shell === "zsh" || shell === "fish" || shell === "powershell")
      return yield* Console.log(completionScript(shell))
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
      const mistyped = mistypedCommand(args)
      if (mistyped !== undefined)
        return yield* report(wantsJson(args), {
          code: "UnknownCommand",
          message: `Unknown command ${mistyped.typed}. Did you mean ${mistyped.command}? To name a project ${mistyped.typed}, run ${BIN} create ${mistyped.typed}.`,
          fix: commandLine(replaceAt(args, mistyped.at, mistyped.command)),
          details: { command: mistyped.typed, suggestion: mistyped.command },
        })
    }
    return yield* runRoot(args)
  }).pipe(Effect.provideService(Invocation, args))

export const main = Stdio.Stdio.use(({ args }) => Effect.flatMap(args, runWith))
