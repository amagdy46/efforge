import { Console, Effect, Stdio } from "effect"
import { type CliError, Command, Completions } from "effect/cli"
import {
  BIN,
  commandLine,
  dropAt,
  dropFlag,
  type ErrorCode,
  type Failure,
  Invocation,
  positionals,
  printSuccess,
  replaceAt,
  report,
  setFlag,
  typoOf,
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

const commands = ["create", "add", "list"]

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
      const typed = e.option.replace(/^-+/, "")
      const near = typoOf(
        typed,
        e.suggestions.map((x) => x.replace(/^-+/, "")),
      )
      // a clear typo (the rule in contract.ts) is corrected; any other unknown flag asked for
      // something efforge doesn't have, and dropping it would do something else: no fix
      if (near === undefined) return null
      // a typo of a flag that is already there (`--jsn --json`): drop it
      if (args.some((t, j) => j !== i && (t === `--${near}` || t.startsWith(`--${near}=`))))
        return dropAt(args, i)
      return replaceAt(args, i, value === undefined ? `--${near}` : `--${near}=${value}`)
    }
    case "InvalidValue": {
      if (e.kind !== "flag") return null
      // a stack flag with no value: which value is the caller's choice (`allowed` lists them)
      if (slotIds.has(e.option)) return null
      if (booleanFlags.has(e.option)) return setFlag(args, e.option)
      // `--log-level=nope`: the rest of the command is unchanged without it
      return dropFlag(args, e.option)
    }
    case "UnexpectedArgument": {
      // `create my app`: a project name is one word, and which one is the caller's choice
      const [first] = positionals(args)
      if (first === undefined || first[1] === "create") return null
      // `list foo`: list takes no arguments, so dropping them runs the same list
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
          ? {
              flag: `--${first.option}`,
              value: first.value,
              expected: first.expected,
              ...(slotIds.has(first.option)
                ? { allowed: slots.find((x) => x.id === first.option)?.options.map((o) => o.id) }
                : {}),
            }
          : first?._tag === "UnexpectedArgument"
            ? { arguments: first.arguments }
            : {},
  })
}

// --- Commands or a project name ------------------------------------------------------
// The root command is `create` with the project name first, so anything that isn't a command is
// a name. That made `lst --json`, `ad email --cwd app` and `help` create projects. So the root
// form takes exactly one word, and it must not look like a command: a reserved word, or a typo
// of one (the rule in contract.ts), is refused. `create <name>` always creates.

/** Words that are, or will be, commands. Only `commands` exist today. */
const reserved = [...commands, "help", "version", "upgrade", "doctor", "info", "graph"]

/** Flags only `add` or `list` take: with them, the root form was never meant as a create. */
const notCreateFlags = new Set(["cwd", "overwrite"])

const flagNames = (args: ReadonlyArray<string>): string[] => {
  const end = args.indexOf("--")
  return (end === -1 ? args : args.slice(0, end))
    .filter((t) => t.startsWith("--"))
    .map((t) => t.slice(2).split("=")[0] as string)
}

/** Why the root form's arguments aren't a create, as the contract reports it; or undefined. */
export const notACreate = (args: ReadonlyArray<string>): Failure | undefined => {
  const pos = positionals(args)
  const [first] = pos
  if (first === undefined || commands.includes(first[1])) return undefined
  const typed = first[1]
  const exact = reserved.includes(typed) ? typed : undefined
  const near = exact ?? typoOf(typed, reserved)
  const list = `The commands are ${commands.join(", ")}.`
  if (near !== undefined) {
    const real = commands.includes(near)
    const same = near === typed
    return {
      code: "UnknownCommand",
      message: `${same ? `${typed} isn't a command.` : `Unknown command ${typed}.${real ? ` Did you mean ${near}?` : ""}`}${near === "help" ? ` For help, run ${BIN} --help.` : near === "version" ? ` For the version, run ${BIN} --version.` : ""} ${list} To name a project ${typed}, run ${BIN} create ${typed}.`,
      fix: real ? commandLine(replaceAt(args, first[0], near)) : null,
      details: {
        command: typed,
        ...(real ? { suggestion: near } : {}),
        commands,
      },
    }
  }
  if (pos.length > 1)
    return {
      code: "UnknownCommand",
      message: `${typed} isn't a command, and a project name is one word. ${list} To create a project, run ${BIN} create <name>.`,
      fix: null,
      details: { command: typed, arguments: pos.slice(1).map(([, w]) => w), commands },
    }
  const other = flagNames(args).find((f) => notCreateFlags.has(f))
  if (other !== undefined)
    return {
      code: "UnknownCommand",
      message: `--${other} belongs to add and list, so ${typed} isn't a project name here, and it isn't a command. ${list}`,
      fix: null,
      details: { command: typed, flag: `--${other}`, commands },
    }
  return undefined
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
    // `--version --json`: the envelope alone says which CLI and contract this is
    if (wantsJson(args) && args.includes("--version") && positionals(args).length === 0)
      return yield* printSuccess({})
    // before parsing: a mistyped `add` rarely parses as a create, and its parse error's fix
    // would turn it into one
    const command = notACreate(args)
    if (command !== undefined) return yield* report(wantsJson(args), command)
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
  }).pipe(Effect.provideService(Invocation, args))

export const main = Stdio.Stdio.use(({ args }) => Effect.flatMap(args, runWith))
