import { Console, Context, Effect } from "effect"
import pc from "picocolors"
import { efforgeVersion } from "./versions.ts"

// The `--json` contract (docs/json.md, ADR 0007). Every document carries `efforge` (the CLI
// version) and `contract` (this number). Adding a field is not a change of contract; renaming or
// removing one, or changing what a field means, bumps it.

export const CONTRACT = 1

/** How every runnable hint starts: works today when copied, with or without a global install. */
export const BIN = "npx create-efforge"

/** Where to report a failure that is efforge's fault, not the caller's. */
export const ISSUES = "https://github.com/amagdy46/efforge/issues"

/** The arguments the CLI was called with, so an error can say what to run instead. */
export const Invocation = Context.Reference<ReadonlyArray<string>>("efforge/Invocation", {
  defaultValue: () => [],
})

/**
 * Every error code an agent can get, with what it means. Stable: a code is never renamed or
 * reused for something else within one contract version. docs/json.md documents each one.
 */
export const errorCodes = {
  UnknownFlag: "A flag efforge doesn't have. `fix` uses the closest flag, or drops it.",
  InvalidFlagValue: "A flag got a value it can't take, or none. `fix` uses a valid value.",
  UnexpectedArgument: "More positional arguments than the command takes. `fix` drops them.",
  UnknownCommand:
    "The first argument looks like a mistyped command (`lst`), not a project name. `fix` uses the command.",
  NeedsInput:
    "A prompt was needed and there is no terminal. Only without --json, which never prompts. `fix` adds --yes.",
  UnknownValue: "A stack flag got a value that isn't one of its options. `fix` uses a valid one.",
  IncompatibleStack:
    "The choices conflict (auth without a database), or `add` needs other add-ons with it. `fix` resolves it.",
  InvalidProjectName: "The name isn't a valid npm package name. `fix` uses a valid one.",
  TargetNotEmpty: "The project directory exists and isn't empty. `fix` uses a free name.",
  PnpmMissing: "pnpm isn't on PATH. `fix` installs it and runs the command again.",
  SetupIncomplete:
    "The files were written but a setup step (install, git) failed. `fix` finishes the setup.",
  WriteFailed: "efforge couldn't write the project files (permissions, disk). No fix.",
  NotAnEfforgeProject:
    "`add` or `list --cwd` was pointed at a directory without efforge.jsonc. `fix` points --cwd at the project when one is nearby.",
  NoAddonIds: "`add` was called with no add-on ids. `available` lists them; `fix` lists them.",
  UnknownAddon:
    "An add-on id that doesn't exist or is ambiguous. `fix` uses the one suggestion, or lists them all.",
  SlotAlreadySet:
    "The project already has a different choice for that slot; `add` can't swap it. No fix: create a new project.",
  RemoveNotSupported: "Removing an add-on (`ai/none`) isn't supported yet. No fix.",
  OverlayConflict:
    "`add` would replace files you edited. Nothing was written. `fix` adds --overwrite, which discards your edits to `files`.",
  TransformAnchorMissing:
    "`add` couldn't find where to edit a file you changed. Nothing was written. Apply `snippet` by hand, then re-run.",
  CommandFailed:
    "`add` wrote its files, then a command it runs (pnpm install) failed. `fix` runs it again.",
  InternalError: "A bug in efforge or a broken install. No fix; report it.",
} as const

export type ErrorCode = keyof typeof errorCodes

/** An error as the contract reports it. `details` become extra fields of `error`. */
export interface Failure {
  readonly code: ErrorCode
  readonly message: string
  readonly fix: string | null
  readonly details?: Readonly<Record<string, unknown>>
  /** Shown to people only (a diff, a command's output): too long for `message`. */
  readonly more?: string
}

export const envelope = { efforge: efforgeVersion, contract: CONTRACT }

export const printJson = (doc: object) => Console.log(JSON.stringify(doc, null, 2))

export const printSuccess = (doc: object) => printJson({ ...envelope, ok: true, ...doc })

/** Prints the failure (one JSON document under --json, else stderr) and sets exit code 1. */
export const report = (json: boolean, f: Failure) =>
  Effect.gen(function* () {
    yield* Effect.sync(() => {
      process.exitCode = 1
    })
    if (json)
      return yield* printJson({
        ...envelope,
        ok: false,
        error: { code: f.code, message: f.message, fix: f.fix, ...f.details },
      })
    const lines = [pc.red(f.message)]
    if (f.more !== undefined && f.more.trim() !== "") lines.push("", f.more.trimEnd())
    if (f.fix !== null) lines.push(`${pc.dim("Try:")} ${f.fix}`)
    yield* Console.error(lines.join("\n"))
  })

/** `InternalError` for anything efforge didn't expect. */
export const internal = (e: { readonly _tag: string; readonly message?: string }): Failure => ({
  code: "InternalError",
  message: `${e.message ?? e._tag} (${e._tag}). This is a bug in efforge or a broken install; please report it at ${ISSUES}.`,
  fix: null,
  details: { cause: e._tag },
})

// --- Re-writing the invocation ---------------------------------------------------------------
// A `fix` is the caller's own command with the smallest change that makes it work, so the edits
// below work on raw argv tokens: `--flag=value`, `--flag value`, `--flag`, positionals.

/** Flags that take a value; their value may be the next token. */
const valueFlags = new Set([
  "runtime",
  "database",
  "orm",
  "auth",
  "infra",
  "ai",
  "extras",
  "cwd",
  "completions",
  "log-level",
])

const isFlag = (t: string) => t.startsWith("-") && t !== "-" && t !== "--"

const flagName = (t: string) => t.replace(/^-+/, "").split("=")[0] as string

/** Indices of the tokens that make up `--name` (with its value), every occurrence. */
const flagSpans = (args: ReadonlyArray<string>, name: string): Array<[number, number]> => {
  const spans: Array<[number, number]> = []
  for (let i = 0; i < args.length; i++) {
    const t = args[i] as string
    if (t === "--") break
    if (!isFlag(t) || flagName(t) !== name) continue
    const next = args[i + 1]
    const takesNext =
      valueFlags.has(name) && !t.includes("=") && next !== undefined && !isFlag(next)
    spans.push([i, takesNext ? i + 2 : i + 1])
  }
  return spans
}

const without = (args: ReadonlyArray<string>, spans: Array<[number, number]>) =>
  args.filter((_, i) => !spans.some(([a, b]) => i >= a && i < b))

/** Positional tokens (not flags, not flag values), with their indices. */
export const positionals = (args: ReadonlyArray<string>): Array<[number, string]> => {
  const out: Array<[number, string]> = []
  for (let i = 0; i < args.length; i++) {
    const t = args[i] as string
    if (t === "--") continue
    if (isFlag(t)) {
      if (valueFlags.has(flagName(t)) && !t.includes("=")) i++
      continue
    }
    out.push([i, t])
  }
  return out
}

/** Sets `--name=value` (or bare `--name` for `true`), replacing any earlier occurrence. */
export const setFlag = (
  args: ReadonlyArray<string>,
  name: string,
  value: string | true = true,
): string[] => [
  ...without(args, flagSpans(args, name)),
  value === true ? `--${name}` : `--${name}=${value}`,
]

export const dropFlag = (args: ReadonlyArray<string>, name: string): string[] =>
  without(args, flagSpans(args, name))

/** Replaces the token at `index`. */
export const replaceAt = (args: ReadonlyArray<string>, index: number, token: string): string[] =>
  args.map((t, i) => (i === index ? token : t))

export const dropAt = (args: ReadonlyArray<string>, index: number): string[] =>
  args.filter((_, i) => i !== index)

export const insertAt = (
  args: ReadonlyArray<string>,
  index: number,
  ...tokens: string[]
): string[] => [...args.slice(0, index), ...tokens, ...args.slice(index)]

const quote = (t: string) => (/^[\w@%+=:,./-]+$/.test(t) ? t : `'${t.replaceAll("'", `'\\''`)}'`)

/** The command line for `args`, as the caller can paste it. */
export const commandLine = (args: ReadonlyArray<string>): string =>
  [BIN, ...args.map(quote)].join(" ")

/** `cd <dir> && ...` relative to where efforge was run, or nothing when it's the same directory. */
export const inDir = (relative: string, commands: ReadonlyArray<string>): string =>
  [...(relative === "" || relative === "." ? [] : [`cd ${quote(relative)}`]), ...commands].join(
    " && ",
  )

/** Edit distance, for "did you mean". */
export const distance = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] as number
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j] as number
      row[j] = Math.min(
        (row[j] as number) + 1,
        (row[j - 1] as number) + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      prev = tmp
    }
  }
  return row[b.length] as number
}

/** The closest of `options` to `value`, if any is within `max` edits. */
export const closest = (
  value: string,
  options: ReadonlyArray<string>,
  max = 2,
): string | undefined => {
  const best = options
    .map((o) => [o, distance(value, o)] as const)
    .toSorted((a, b) => a[1] - b[1])[0]
  return best !== undefined && best[1] <= max ? best[0] : undefined
}
