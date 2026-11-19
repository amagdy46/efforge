import { Console, Effect, Option, Stdio } from "effect"
import { type CliError, CliOutput, Command, Completions } from "effect/cli"
import { BIN, type ErrorCode, type Failure, Invocation, printSuccess, report } from "./contract.ts"
import { addCommand } from "./commands/add.ts"
import { createCommand, createConfig, createHandler, presetFailure } from "./commands/create.ts"
import { graphCommand } from "./commands/graph.ts"
import { infoCommand } from "./commands/info.ts"
import { listCommand } from "./commands/list.ts"
import { commands, fix, intentOf, meantFlag, projectAbove, spelledOut } from "./fix.ts"
import { slots } from "./slots.ts"
import { efforgeVersion } from "./versions.ts"

/** Root behaves as `create`; `efforge create` is an explicit alias, `add` and `list` are separate. */
export const root = Command.make("create-efforge", createConfig, createHandler).pipe(
  Command.withDescription(
    "Scaffold an Effect + TanStack Start app on Cloudflare with database, auth and services already wired together",
  ),
  Command.withSubcommands([createCommand, addCommand, listCommand, infoCommand, graphCommand]),
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
    { command: "npx create-efforge info email", description: "What one add-on adds and needs" },
    { command: "npx create-efforge graph", description: "The project's layer graph, as Mermaid" },
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
    Command.withHandler(infoCommand, () => Effect.void),
    Command.withHandler(graphCommand, () => Effect.void),
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

/** The values a flag takes, from Effect's `expected` ("\"bash\" | \"zsh\""), or a slot's options. */
const allowedFor = (option: string, expected: string): string[] | undefined => {
  if (slotIds.has(option)) return slots.find((x) => x.id === option)?.options.map((o) => o.id)
  const quoted = [...expected.matchAll(/"([^"]*)"/g)].map((m) => m[1] as string)
  return quoted.length > 0 ? quoted : undefined
}

/** The `fix` for a parse error, through the one place fixes are built (src/fix.ts). */
const parseFix = (args: ReadonlyArray<string>, e: CliError.NonShowHelpErrors): string | null => {
  switch (e._tag) {
    case "UnrecognizedOption": {
      const typed = e.option.replace(/^-+/, "")
      return fix(args, (i) => {
        if (i.verb === undefined) return undefined
        const at = i.flags.findIndex((f) => f.name === typed)
        const flag = i.flags[at]
        if (flag === undefined) return undefined
        // `--name=app`: the name is positional
        if (typed === "name" && typeof flag.value === "string" && i.operands.length === 0)
          return { ...i, operands: [flag.value], flags: i.flags.filter((_, k) => k !== at) }
        // a clear typo (the rule in contract.ts) is corrected; a flag of the command given
        // before the command (`--cwd app list`) moves after it; anything else asked for
        // something efforge doesn't have, and dropping it would do something else
        const meant = meantFlag(i.verb, typed)
        if (meant === undefined) return undefined
        if (meant.name === typed) return i
        // a typo of a flag that is already there (`--jsn --json`): drop it
        if (
          i.flags.some(
            (f, k) => k !== at && meantFlag(i.verb ?? "create", f.name)?.name === meant.name,
          )
        )
          return { ...i, flags: i.flags.filter((_, k) => k !== at) }
        const value = meant.negated ? (flag.value === true ? false : flag.value) : flag.value
        return {
          ...i,
          flags: i.flags.map((f, k) =>
            k === at ? { name: meant.name, value: value === undefined ? true : value } : f,
          ),
        }
      })
    }
    case "UnexpectedArgument":
      // `list foo`: list takes no arguments, so dropping them runs the same list. `create my
      // app`: a project name is one word, and which one is the caller's choice
      return fix(args, (i) =>
        i.verb === "list" || i.verb === "graph" ? { ...i, operands: [] } : undefined,
      )
    default:
      // a value a flag can't take, or none: which value is the caller's choice (`allowed`)
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
  const allowed =
    first?._tag === "InvalidValue" ? allowedFor(first.option, first.expected) : undefined
  return report(wantsJson(args), {
    code: first === undefined ? "InternalError" : parseCode(first),
    message: `${error.errors.map(describeParseError).join(" ")} ${help}`,
    fix: first === undefined ? null : parseFix(args, first),
    details:
      first?._tag === "UnrecognizedOption"
        ? { flag: first.option, suggestions: first.suggestions }
        : first?._tag === "InvalidValue"
          ? {
              flag: `--${first.option}`,
              value: first.value,
              expected: first.expected,
              ...(allowed === undefined ? {} : { allowed }),
            }
          : first?._tag === "UnexpectedArgument"
            ? { arguments: first.arguments }
            : {},
  })
}

// --- Commands or a project name ------------------------------------------------------
// The root command is `create` with the project name first, so anything that isn't a command is
// a name. That made `lst --json`, `ad email --cwd app`, `help` and `update` create projects. So
// the root form takes exactly one word, it must not be a word people guess as a command
// (`reservedWords`, src/fix.ts) or a typo of one, and it doesn't run inside a project, where `add`
// and `list` are meant. `create <name>` always creates.

/** Each command's flags, from the definitions (what completions are made from). */
const flagsByCommand = (): ReadonlyArray<{ name: string; flags: ReadonlyArray<string> }> =>
  (
    Completions.fromCommand(root) as unknown as {
      subcommands: ReadonlyArray<{ name: string; flags: ReadonlyArray<{ name: string }> }>
    }
  ).subcommands.map((c) => ({ name: c.name, flags: c.flags.map((f) => f.name) }))

/** The commands that take `--flag`, as "add, list and graph". */
const owners = (flag: string): string => {
  const names = flagsByCommand()
    .filter((c) => c.flags.includes(flag))
    .map((c) => c.name)
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}

/** Flags only other commands take: with one, the root form was never meant as a create. */
const notCreateFlags = (): ReadonlySet<string> => {
  const all = flagsByCommand()
  const create = new Set(all.find((c) => c.name === "create")?.flags ?? [])
  return new Set(all.flatMap((c) => c.flags).filter((f) => !create.has(f)))
}

/** Why the arguments aren't a create or a command, as the contract reports it; or undefined. */
export const notACreate = (args: ReadonlyArray<string>): Failure | undefined => {
  const i = intentOf(args)
  const list = `The commands are ${commands.join(", ")}.`
  // a command in other case or mistyped (`Add`, `lst`): that command
  if (i.word !== undefined && i.verb !== undefined && i.word !== i.verb) {
    const typed = i.word
    return {
      code: "UnknownCommand",
      message: `Unknown command ${typed}. Did you mean ${i.verb}? ${list}${i.verb === "create" ? "" : ` To name a project ${typed}, run ${BIN} create ${typed}.`}`,
      fix: fix(args, spelledOut),
      details: { command: typed, suggestion: i.verb, commands },
    }
  }
  if (i.word !== undefined) return undefined
  const [typed] = i.operands
  if (typed !== undefined && i.verb === undefined) {
    const lower = typed.toLowerCase()
    const dashed = (commands as ReadonlyArray<string>).includes(lower)
    const hint = dashed
      ? ` To run ${lower}, put it before --.`
      : lower === "help"
        ? ` For help, run ${BIN} --help.`
        : lower === "version"
          ? ` For the version, run ${BIN} --version.`
          : lower === "ls"
            ? ` To see the add-ons, run ${BIN} list.`
            : ""
    return {
      code: "UnknownCommand",
      message: `${dashed ? `${typed} after -- is an argument, not the command,` : `${typed} isn't a command,`} and efforge doesn't take it as a project name.${hint} ${list} To name a project ${typed}, run ${BIN} create ${typed}.`,
      fix: null,
      details: { command: typed, commands },
    }
  }
  if (i.operands.length > 1)
    return {
      code: "UnknownCommand",
      message: `${typed} isn't a command, and a project name is one word. ${list} To create a project, run ${BIN} create <name>.`,
      fix: null,
      details: { command: typed, arguments: i.operands.slice(1), commands },
    }
  const notCreate = notCreateFlags()
  const other = i.flags.find((f) => notCreate.has(f.name))
  if (other !== undefined && typed !== undefined)
    return {
      code: "UnknownCommand",
      message: `--${other.name} belongs to ${owners(other.name)}, so ${typed} isn't a project name here, and it isn't a command. ${list}`,
      fix: null,
      details: { command: typed, flag: `--${other.name}`, commands },
    }
  // the built-in flags print text and create nothing
  if (i.flags.some((f) => ["help", "version", "completions"].includes(f.name))) return undefined
  const project = projectAbove(process.cwd())
  if (project !== undefined)
    return {
      code: "InsideProject",
      message: `This is inside the efforge project ${project}, so efforge doesn't create a project here without the word create. ${list} To add to this project, run ${BIN} add <id>; to create a project inside it anyway, run ${BIN} create ${typed ?? "<name>"}.`,
      fix: null,
      details: { project, ...(typed === undefined ? {} : { name: typed }), commands },
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

// --- Help ----------------------------------------------------------------------------
// Effect's help lists the global flags with every value in the flag's column, which pushes every
// description to column 70 and the lines past 150, and it starts EXAMPLES without a blank line.

const globalFlagDocs: Readonly<Record<string, { type: string; description: string }>> = {
  completions: {
    type: "<shell>",
    description: "Print a shell completion script: bash, zsh, fish or powershell",
  },
  "log-level": {
    type: "<level>",
    description: "Minimum log level: all, trace, debug, info, warn, error, fatal or none",
  },
}

/** Effect's help formatter, with short global flags and a blank line before EXAMPLES. */
export const helpFormatter = (base: CliOutput.Formatter): CliOutput.Formatter => ({
  formatCliError: (e) => base.formatCliError(e),
  formatError: (e) => base.formatError(e),
  formatErrors: (es) => base.formatErrors(es),
  formatVersion: (name, version) => base.formatVersion(name, version),
  formatHelpDoc: (doc) =>
    base
      .formatHelpDoc({
        ...doc,
        ...(doc.globalFlags === undefined
          ? {}
          : {
              globalFlags: doc.globalFlags.map((f) => {
                const short = globalFlagDocs[f.name]
                return short === undefined
                  ? f
                  : { ...f, type: short.type, description: Option.some(short.description) }
              }),
            }),
      })
      .replace(/([^\n])\n((?:\S*\[1m)?EXAMPLES)/, "$1\n\n$2"),
})

const runRoot = (args: ReadonlyArray<string>) =>
  Command.runWith(root, { version: efforgeVersion })(args).pipe(
    Effect.provide(CliOutput.layer(helpFormatter(CliOutput.defaultFormatter()))),
  )
const runProbe = Command.runWith(probe, { version: efforgeVersion, renderErrors: false })

/** Runs the CLI with explicit arguments (the entry point reads them from Stdio; tests pass them). */
export const runWith = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const shell = completionShell(args)
    if (shell === "bash" || shell === "zsh" || shell === "fish" || shell === "powershell")
      return yield* Console.log(completionScript(shell))
    // `--version --json`: the envelope alone says which CLI and contract this is
    if (wantsJson(args) && args.includes("--version") && intentOf(args).operands.length === 0)
      return yield* printSuccess({})
    // before parsing: a mistyped `add` rarely parses as a create, and its parse error's fix
    // would turn it into one
    const command = notACreate(args) ?? presetFailure(args)
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
