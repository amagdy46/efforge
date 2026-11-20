import { Console, Context, Effect } from "effect"
import pc from "picocolors"
import { efforgeVersion } from "./versions.ts"
import { wrapProse } from "./wrap.ts"

// The `--json` contract (docs/json.md, ADR 0007). Every document carries `efforge` (the CLI
// version) and `contract` (this number). Adding a field is not a change of contract; renaming or
// removing one, or changing what a field means, bumps it.

export const CONTRACT = 1

/**
 * How every runnable hint, `fix` and `command` starts: works when copied, with or without a
 * global install, and `-y` keeps npx from asking before it downloads the package.
 */
export const BIN = "npx -y create-efforge"

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
  UnknownFlag:
    "A flag efforge doesn't have. `fix` uses the flag it is a clear typo of, or moves a flag to after the command; else null.",
  InvalidFlagValue:
    "A flag got a value it can't take, or none. `fix` is null; `allowed` lists the values when there is a list.",
  UnexpectedArgument:
    "More words than the command takes. For `list` and `graph`, `fix` drops them; for `create`, null (a name is one word).",
  UnknownCommand:
    "The first word is a typo of a command (`lst`), a command in other case (`Add`), or a word efforge keeps for commands (`update`), not a project name. `fix` is the command it names, or null.",
  InsideProject:
    "The bare root form (no `create`) was run inside an efforge project, where `add` and `list` are meant. No fix; `create <name>` makes a nested project if that is what you want.",
  NeedsInput:
    "A prompt was needed and there is no terminal. Only without --json, which never prompts. `fix` adds --yes.",
  UnknownValue:
    "A stack flag, or `--preset`, got a value that isn't one of its options. `fix` uses the option it is a clear typo of, or is null.",
  IncompatibleStack:
    "The choices conflict (auth without a database), or `add` needs another add-on with it. No fix: `alternatives` lists the ways out, each a complete command.",
  InvalidProjectName:
    "The name isn't a valid npm package name. `fix` only lower-cases it and joins its words with hyphens (`My App`); a path or anything else is null.",
  TargetNotEmpty:
    "The project directory exists and isn't empty. When it holds an unfinished project with the same stack, `fix` finishes it; else null.",
  PnpmMissing: "pnpm isn't on PATH. `fix` installs it and runs the command again.",
  SetupIncomplete:
    "The files were written but a setup step (install, git) failed. `fix` finishes the setup.",
  Interrupted:
    "--json only: the run was stopped (Ctrl-C, SIGTERM, a timeout). Exit code 130. `fix` finishes the setup when files were written.",
  WriteFailed: "efforge couldn't write the project files (permissions, disk). No fix.",
  NotAnEfforgeProject:
    "`add`, `upgrade`, `doctor`, `info`, `graph` or `list --cwd` was pointed at a directory without a valid efforge.jsonc (`list` in a directory without one succeeds with `project: false`). `fix` points --cwd at the nearby project when there is one; else null.",
  NoAddonIds:
    "`add` was called with no add-on ids and no terminal to pick them in (or with --json), or `info` with no id. No fix: pick from `available`.",
  UnknownAddon:
    "An add-on id that doesn't exist or is ambiguous. `fix` uses the one id it is a clear typo or fragment of; else null with `suggestions`.",
  SlotAlreadySet:
    "The project already has a different choice for that slot; `add` can't swap it. No fix: create a new project.",
  RemoveNotSupported: "Removing an add-on (`ai/none`) isn't supported yet. No fix.",
  UpgradeFirst:
    "`add` would write cards the project's card boundary (apps/web/src/server/outcome.ts, from an older efforge) can't typecheck. Nothing was written. `fix` is `upgrade` in the same project; `after` is the add to run once it is done.",
  OverlayConflict:
    "`add` would replace files you edited. Nothing was written. `fix` adds --overwrite, which discards your edits to `files`.",
  TransformAnchorMissing:
    "`add` couldn't find where to edit a file you changed. Nothing was written. Apply `snippet` by hand, then re-run.",
  CommandFailed:
    "`add` or `upgrade` wrote its files, then a command it runs (pnpm install) failed. `fix` runs it again.",
  LayersUnreadable:
    "`graph` couldn't read the layers: apps/web/src/server/layers.ts is missing or has no `export const AppLayer = Layer.mergeAll(...)`. No fix.",
  ReadmeUnwritable:
    "`graph --write` found no efforge:readme markers in README.md, broken ones, or no README. Nothing was written. No fix: `problems` says what to repair.",
  ProjectNewerThanCli:
    "`upgrade` was run by an efforge older than the one that made or last upgraded the project, which would undo the newer one's changes. Nothing was written. No fix; `command` is the same command with create-efforge@latest.",
  UncommittedChanges:
    "`upgrade` found changes in the project that aren't committed, so git diff couldn't show what it did. Nothing was written. No fix: commit or stash first; `command` is the same command with --allow-dirty.",
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
    // wrapped like prompts and ordinary output: at 80 columns, never inside a command or a path
    const width = Math.min(80, process.stderr.columns || 80)
    const lines = [pc.red(wrapProse(f.message, width))]
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

/** A token as the shell needs it: bare when safe, else in single quotes. */
export const quote = (t: string) =>
  /^[\w@%+=:,./-]+$/.test(t) ? t : `'${t.replaceAll("'", `'\\''`)}'`

/** `cd <dir> && ...` relative to where efforge was run, or nothing when it's the same directory. */
export const inDir = (relative: string, commands: ReadonlyArray<string>): string =>
  [...(relative === "" || relative === "." ? [] : [`cd ${quote(relative)}`]), ...commands].join(
    " && ",
  )

/** Edit distance where swapping two neighbours counts as one edit (optimal string alignment). */
export const distance = (a: string, b: string): number => {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_row, i) =>
    Array.from({ length: b.length + 1 }, (_col, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  const at = (i: number, j: number) => (d[i] as number[])[j] as number
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const same = a[i - 1] === b[j - 1]
      let v = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + (same ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, at(i - 2, j - 2) + 1)
      ;(d[i] as number[])[j] = v
    }
  return at(a.length, b.length)
}

/**
 * The typo rule, the one place efforge decides that `typed` was meant as `option`. A `fix` built
 * on it must never swap in a different value, so it is tight:
 * - an option of one or two characters (`d1`) only matches exactly: every short word is a couple
 *   of edits from it;
 * - otherwise one edit (a swap of neighbours counts as one) for options up to six characters,
 *   two for longer ones.
 */
export const isTypo = (typed: string, option: string): boolean => {
  if (typed === option || option.length <= 2) return false
  return distance(typed, option) <= (option.length <= 6 ? 1 : 2)
}

/** The one option `value` is a typo of, or undefined when none or more than one is. */
export const typoOf = (value: string, options: ReadonlyArray<string>): string | undefined => {
  const near = [...new Set(options)].filter((o) => isTypo(value, o))
  return near.length === 1 ? near[0] : undefined
}
