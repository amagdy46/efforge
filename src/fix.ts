import { existsSync, readdirSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { BIN, inDir, isTypo, quote, typoOf } from "./contract.ts"
import { COMMIT, FORMAT, INSTALL } from "./exec.ts"
import { presetIds } from "./presets.ts"
import { nameError } from "./prompts/flow.ts"
import { slots } from "./slots.ts"

// Every `fix` is built here (docs/json.md, "`fix` is a promise"; ADR 0007). An error never edits
// argv tokens itself: it edits the caller's intent (the command, the name or ids, the flags), and
// `fix` checks the edited intent against the original before rendering it. A candidate that would
// run a different command, create a project the caller didn't name, drop or change a choice the
// caller made (other than a clear typo), or repeat the caller's own command, is refused: the
// error then carries `fix: null` and its facts.

export const commands = ["create", "add", "list", "info", "graph", "upgrade", "doctor"] as const
export type Verb = (typeof commands)[number]

/**
 * Words the bare root form refuses as a project name, because people and agents guess them as
 * commands. `create <word>` still takes any of them. A command added later must be here first.
 */
export const reservedWords: ReadonlyArray<string> = [
  ...commands,
  "help",
  "version",
  "upgrade",
  "update",
  "remove",
  "rm",
  "uninstall",
  "delete",
  "install",
  "init",
  "new",
  "ls",
  "show",
  "status",
  "info",
  "doctor",
  "graph",
  "run",
  "dev",
  "start",
  "build",
  "check",
  "lint",
  "test",
  "deploy",
  "publish",
  "migrate",
  "generate",
  "config",
  "login",
  "logout",
]

/**
 * Of the reserved words, the ones whose typos are refused too (`hlep`, `upgarde`). Short words are
 * left out: a typo of `ls` or `run` is as likely a name (`rum`, `lx`) as a command.
 */
const typoChecked: ReadonlyArray<string> = [
  ...commands,
  "help",
  "version",
  "upgrade",
  "update",
  "remove",
  "uninstall",
  "install",
  "delete",
  "doctor",
  "deploy",
]

/** The command `word` names: exactly, ignoring case (`Add`), or as a clear typo (`lst`). */
export const commandOf = (word: string): Verb | undefined => {
  const lower = word.toLowerCase()
  return (commands as ReadonlyArray<string>).includes(lower)
    ? (lower as Verb)
    : (typoOf(lower, commands) as Verb | undefined)
}

/** True when the root form must not take `word` as a project name. */
export const looksLikeCommand = (word: string): boolean => {
  const lower = word.toLowerCase()
  return reservedWords.includes(lower) || typoOf(lower, typoChecked) !== undefined
}

// --- Flags -------------------------------------------------------------------------------

const stackFlags = slots.map((s) => s.id as string)
/** Flags whose value is one of a list: the stack flags and `--preset`. */
const choicesOf = (name: string): ReadonlyArray<string> | undefined =>
  name === "preset" ? presetIds : slots.find((s) => s.id === name)?.options.map((o) => o.id)
const globalValues = ["log-level", "completions"]
const globalBooleans = ["help", "version"]
const known: Record<Verb, { readonly values: string[]; readonly booleans: string[] }> = {
  create: {
    values: ["preset", ...stackFlags, ...globalValues],
    booleans: ["yes", "dry-run", "verbose", "json", "install", "git", ...globalBooleans],
  },
  add: {
    values: ["cwd", ...globalValues],
    booleans: ["overwrite", "dry-run", "json", "install", ...globalBooleans],
  },
  list: { values: ["cwd", ...globalValues], booleans: ["json", ...globalBooleans] },
  info: { values: ["cwd", ...globalValues], booleans: ["json", ...globalBooleans] },
  graph: {
    values: ["cwd", "format", ...globalValues],
    booleans: ["json", "write", ...globalBooleans],
  },
  upgrade: {
    values: ["cwd", "file", ...globalValues],
    booleans: [
      "check",
      "dry-run",
      "diff",
      "verbose",
      "strict",
      "allow-dirty",
      "install",
      "json",
      ...globalBooleans,
    ],
  },
  doctor: { values: ["cwd", ...globalValues], booleans: ["online", "json", ...globalBooleans] },
}

/** The commands that take `--flag`, in `commands` order. */
export const commandsTaking = (flag: string): Verb[] =>
  commands.filter((v) => known[v].values.includes(flag) || known[v].booleans.includes(flag))
const allValueFlags = new Set(["preset", ...stackFlags, "cwd", "format", "file", ...globalValues])
const allBooleans = new Set(Object.values(known).flatMap((k) => k.booleans))
const shortFlags: Record<string, string> = { y: "yes", h: "help", v: "version" }
const truthy = new Set(["true", "yes", "on", "1", "y"])
const falsy = new Set(["false", "no", "off", "0", "n"])
const logLevels = new Set([
  "all",
  "trace",
  "debug",
  "info",
  "warn",
  "warning",
  "error",
  "fatal",
  "none",
])

/** A flag as typed. `value` is the text after `=` or the next token; true/false for switches. */
export interface Flag {
  readonly name: string
  readonly value: string | boolean | undefined
  /** The tokens as typed, kept when the flag is unchanged so a fix reads like the caller's. */
  readonly raw?: ReadonlyArray<string>
}

/** The flag `name` (as typed) means for `verb`: itself, `--no-x`, or a clear typo of one. */
export const meantFlag = (
  verb: Verb,
  name: string,
): { readonly name: string; readonly negated: boolean } | undefined => {
  const { values, booleans } = known[verb]
  const all = [...values, ...booleans]
  if (all.includes(name)) return { name, negated: false }
  const base = name.startsWith("no-") ? name.slice(3) : undefined
  if (base !== undefined && booleans.includes(base)) return { name: base, negated: true }
  const near = typoOf(name, all)
  if (near !== undefined) return { name: near, negated: false }
  const nearBase = base === undefined ? undefined : typoOf(base, booleans)
  return nearBase === undefined ? undefined : { name: nearBase, negated: true }
}

// --- Intent ------------------------------------------------------------------------------

/** What the caller asked for, read from argv the way the CLI reads it. */
export interface Intent {
  /** The command; undefined when the first word is a reserved word, so no command at all. */
  readonly verb: Verb | undefined
  /** The command word as typed (`lst`, `Add`), or undefined for the bare root form (a create). */
  readonly word: string | undefined
  /** The words after the command: the name for `create`, the ids for `add`. */
  readonly operands: ReadonlyArray<string>
  readonly flags: ReadonlyArray<Flag>
}

const isFlagToken = (t: string) => t.startsWith("-") && t !== "-" && t !== "--"

const takesValue = (name: string) =>
  allValueFlags.has(name) ||
  (!allBooleans.has(name) &&
    !(name.startsWith("no-") && allBooleans.has(name.slice(3))) &&
    typoOf(name, [...allValueFlags]) !== undefined)

export const intentOf = (args: ReadonlyArray<string>): Intent => {
  const words: string[] = []
  const flags: Flag[] = []
  /** Words before `--`: only one of those can be the command. */
  let beforeDashes = Number.POSITIVE_INFINITY
  for (let i = 0; i < args.length; i++) {
    const t = args[i] as string
    if (t === "--") {
      beforeDashes = words.length
      words.push(...args.slice(i + 1))
      break
    }
    if (!isFlagToken(t)) {
      words.push(t)
      continue
    }
    if (!t.startsWith("--")) {
      const short = t.slice(1)
      flags.push({ name: shortFlags[short] ?? short, value: true, raw: [t] })
      continue
    }
    const eq = t.indexOf("=")
    const name = eq < 0 ? t.slice(2) : t.slice(2, eq)
    if (eq >= 0) {
      const v = t.slice(eq + 1)
      const lower = v.toLowerCase()
      const value = allBooleans.has(name)
        ? truthy.has(lower)
          ? true
          : falsy.has(lower)
            ? false
            : v
        : v
      flags.push({ name, value, raw: [t] })
    } else if (takesValue(name)) {
      const next = args[i + 1]
      if (next !== undefined && !isFlagToken(next) && next !== "--") {
        flags.push({ name, value: next, raw: [t, next] })
        i++
      } else flags.push({ name, value: undefined, raw: [t] })
    } else if (name.startsWith("no-") && allBooleans.has(name.slice(3)))
      flags.push({ name: name.slice(3), value: false, raw: [t] })
    else flags.push({ name, value: true, raw: [t] })
  }
  const [first, ...rest] = words
  // after `--` a word is an argument, never the command: `-- add` would be a project named add
  if (
    first !== undefined &&
    beforeDashes === 0 &&
    (commandOf(first) !== undefined || looksLikeCommand(first))
  )
    return { verb: undefined, word: undefined, operands: words, flags }
  const verb = first === undefined ? undefined : commandOf(first)
  if (first !== undefined && verb !== undefined) return { verb, word: first, operands: rest, flags }
  // the bare root form: a create, unless its word is one people guess as a command
  if (first !== undefined && looksLikeCommand(first))
    return { verb: undefined, word: undefined, operands: words, flags }
  return { verb: "create", word: undefined, operands: words, flags }
}

/** The tokens for `intent`: the command first, then the name or ids, then the flags. */
export const render = (i: Intent): string[] => {
  const dashed = i.operands.some((o) => o.startsWith("-"))
  return [
    ...(i.word === undefined || i.verb === undefined ? [] : [i.verb]),
    ...(dashed ? [] : i.operands),
    ...i.flags.flatMap((f) =>
      f.raw !== undefined
        ? f.raw
        : f.value === true
          ? [`--${f.name}`]
          : f.value === false
            ? [`--no-${f.name}`]
            : f.value === undefined
              ? [`--${f.name}`]
              : [`--${f.name}=${f.value}`],
    ),
    ...(dashed ? ["--", ...i.operands] : []),
  ]
}

/** The flags `i` sets, under the names they mean; `unknown` are the ones that mean nothing. */
const view = (i: Intent) => {
  const verb = i.verb ?? "create"
  const set = new Map<string, string | boolean | undefined>()
  const counts = new Map<string, number>()
  const unknown: string[] = []
  let name: string | undefined = verb === "create" ? i.operands[0] : undefined
  for (const f of i.flags) {
    // `--name=app`: the name is positional, and this is the name the caller gave
    if (
      verb === "create" &&
      f.name === "name" &&
      typeof f.value === "string" &&
      name === undefined
    ) {
      name = f.value
      continue
    }
    const m = meantFlag(verb, f.name)
    if (m === undefined) {
      unknown.push(f.name)
      continue
    }
    counts.set(m.name, (counts.get(m.name) ?? 0) + 1)
    set.set(m.name, m.negated ? (f.value === true ? false : f.value) : f.value)
  }
  return { set, counts, unknown, name }
}

const defaults: Record<string, boolean> = { install: true, git: true }

/** A switch's value, with its default; a string means a value it can't take. */
const switchOf = (v: ReturnType<typeof view>, name: string): boolean | string => {
  const x = v.set.get(name)
  return x === undefined ? (defaults[name] ?? false) : x
}

/** The project that holds `dir`: `dir` itself or a parent with an efforge.jsonc. */
export const projectAbove = (dir: string): string | undefined => {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, "efforge.jsonc"))) return d
    if (d === dirname(d)) return undefined
  }
}

/** The efforge project nearest to `dir`: a parent, or the one child that holds efforge.jsonc. */
export const nearbyProject = (dir: string): string | undefined => {
  for (let d = dirname(dir); d !== dirname(d); d = dirname(d))
    if (existsSync(join(d, "efforge.jsonc"))) return d
  try {
    const children = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "efforge.jsonc")))
      .map((e) => join(dir, e.name))
    return children.length === 1 ? children[0] : undefined
  } catch {
    return undefined
  }
}

/** Whether `c` runs as it reads: a command, no unknown or repeated flags, every value valid. */
const wellFormed = (c: Intent): boolean => {
  if (c.verb === undefined || (c.word !== undefined && c.word !== c.verb)) return false
  const v = view(c)
  if (v.unknown.length > 0 || [...v.counts.values()].some((n) => n > 1)) return false
  if (c.flags.some((f) => f.name === "name")) return false
  for (const [name, value] of v.set) {
    if (name === "help" || name === "version" || name === "completions") return false
    if (known[c.verb].booleans.includes(name)) {
      if (typeof value !== "boolean") return false
    } else if (typeof value !== "string") return false
    else if (name === "log-level" && !logLevels.has(value)) return false
    else if (name === "format" && value !== "mermaid" && value !== "text") return false
    else if (stackFlags.includes(name) || name === "preset") {
      const options = choicesOf(name) ?? []
      const values = name === "extras" ? value.split(",").filter((x) => x !== "") : [value]
      if (values.some((x) => !options.includes(x))) return false
    }
  }
  // info takes one id; create and add take words; the rest take none
  if (c.verb === "info" && c.operands.length > 1) return false
  if (c.verb !== "create" && c.verb !== "add" && c.verb !== "info" && c.operands.length > 0)
    return false
  if (c.verb === "create") {
    if (c.operands.length > 1) return false
    if (c.word === undefined) {
      const [name] = c.operands
      if (name !== undefined && looksLikeCommand(name)) return false
      if (projectAbove(process.cwd()) !== undefined) return false
    }
  }
  return true
}

/**
 * The name `raw` was meant as when it differs from a valid one only by case and spaces
 * (`My App` -> `my-app`); undefined for anything else, a path above all (`../app`, `a/b`).
 */
export const meantName = (raw: string): string | undefined => {
  if (/[\\/]/.test(raw) && !/^@[^/\\]+\/[^/\\]+$/.test(raw)) return undefined
  const name = raw.trim().toLowerCase().replace(/\s+/g, "-")
  return name === "" || nameError(name) !== undefined ? undefined : name
}

/** Ids `id` could mean (the add-on rule): every id a 3+ letter fragment starts, else one clear typo. */
export const addonSuggestions = (id: string): string[] => {
  const all = slots.flatMap((s) =>
    s.options.filter((o) => o.id !== "none").map((o) => `${s.id}/${o.id}`),
  )
  const partial =
    id.length >= 3 ? all.filter((full) => full.split("/").some((part) => part.startsWith(id))) : []
  if (partial.length > 0) return partial
  const near = all.filter((full) => [full, full.split("/")[1] as string].some((c) => isTypo(id, c)))
  return near.length === 1 ? near : []
}

/** `c`'s value for a stack slot is `o`'s, or the one valid value `o`'s is a clear typo of. */
const sameChoice = (slot: string, o: unknown, c: unknown): boolean => {
  if (o === c) return true
  if (typeof o !== "string" || typeof c !== "string") return false
  const options = choicesOf(slot) ?? []
  // the same value in other case (`D1`, `SaaS`) is that value, as add-on ids are
  const meant = (x: string) =>
    options.includes(x)
      ? x
      : (options.find((v) => v === x.toLowerCase()) ?? typoOf(x, options) ?? x)
  if (slot !== "extras") return meant(o) === c
  const list = (s: string) => s.split(",").filter((x) => x !== "")
  return [...new Set(list(o).map(meant))].join(",") === list(c).join(",")
}

/** What, beyond the rules every fix follows, the error allows the fix to change. */
export interface May {
  /** `--cwd` may point at another directory that holds an efforge project. */
  readonly cwd?: boolean
  /** `--overwrite` may be added (`OverlayConflict`: the caller sees what it discards). */
  readonly overwrite?: boolean
  /** `add` or `info` may become `list` with the same `--json` and `--cwd` (`NoAddonIds`, read-only). */
  readonly list?: boolean
  /** The same command again, after something else changed (`PnpmMissing`). */
  readonly again?: boolean
}

/** Whether `c` keeps everything `o` asked for. */
const keeps = (o: Intent, c: Intent, may: May): boolean => {
  if (o.verb === undefined || c.verb === undefined) return false
  const toList = may.list === true && (o.verb === "add" || o.verb === "info") && c.verb === "list"
  if (c.verb !== o.verb && !toList) return false
  if ((o.word === undefined) !== (c.word === undefined)) return false
  const vo = view(o)
  const vc = view(c)
  // something the caller asked for that no flag means: dropping it would do something else
  if (vo.unknown.length > 0) return false
  const value = (v: ReturnType<typeof view>, name: string) =>
    known[c.verb as Verb].booleans.includes(name) ? switchOf(v, name) : v.set.get(name)
  // every flag either side sets is the same, except the changes listed here
  const names = toList ? ["json", "log-level"] : [...new Set([...vo.set.keys(), ...vc.set.keys()])]
  for (const name of names) {
    if (name === "cwd") continue
    if (stackFlags.includes(name) || name === "preset") {
      if (!sameChoice(name, vo.set.get(name), vc.set.get(name))) return false
    } else if (name === "yes") {
      if (switchOf(vo, "yes") === true && switchOf(vc, "yes") !== true) return false
    } else if (name === "overwrite" && may.overwrite === true) {
      if (switchOf(vc, "overwrite") !== true) return false
    } else if (value(vo, name) !== value(vc, name)) return false
  }
  if (c.verb !== "create") {
    const from = resolve(String(vo.set.get("cwd") ?? "."))
    const to = resolve(String(vc.set.get("cwd") ?? "."))
    if (from !== to && !(may.cwd === true && existsSync(join(to, "efforge.jsonc")))) return false
  }
  if (c.verb === "list" || c.verb === "graph" || c.verb === "upgrade" || c.verb === "doctor")
    return c.operands.length === 0
  if (c.verb === "add" || c.verb === "info") {
    if (o.operands.length !== c.operands.length) return false
    return o.operands.every((id, k) => {
      const to = c.operands[k] as string
      return id === to || addonSuggestions(id.trim().toLowerCase()).join() === to
    })
  }
  // create: one word, the same name (or the one it was meant as)
  if (o.operands.length > 1) return false
  return vo.name === undefined
    ? vc.name === undefined
    : vc.name === vo.name || vc.name === meantName(vo.name)
}

/** The command line for `args`, ready to paste; a create that would prompt gets `--yes`. */
export const commandLine = (args: ReadonlyArray<string>): string => {
  const i = intentOf(args)
  const v = view(i)
  const asks =
    i.verb === "create" &&
    switchOf(v, "yes") !== true &&
    switchOf(v, "json") !== true &&
    switchOf(v, "help") !== true
  // before `--`, where it is still a flag
  const end = args.indexOf("--")
  const tokens = !asks
    ? args
    : end < 0
      ? [...args, "--yes"]
      : [...args.slice(0, end), "--yes", ...args.slice(end)]
  return [BIN, ...tokens.map(quote)].join(" ")
}

/**
 * The one way to build a `fix` that runs efforge: `edit` changes the caller's intent, and the
 * result is a command only when it keeps everything the caller asked for (see `keeps`) and
 * differs from what they ran. Otherwise null.
 */
export const fix = (
  args: ReadonlyArray<string>,
  edit: (i: Intent) => Intent | undefined,
  may: May = {},
): string | null => {
  const o = intentOf(args)
  if (o.verb === undefined) return null
  const edited = edit(o)
  if (edited === undefined) return null
  const tokens = render(edited)
  const c = intentOf(tokens)
  if (!wellFormed(c) || !keeps(o, c, may)) return null
  if (may.again !== true && tokens.join("\0") === args.join("\0")) return null
  return commandLine(tokens)
}

/**
 * A command that does something other than what the caller asked (one of several ways out of a
 * conflict, or the same create without `--dry-run`). Not a `fix`; still runs as it reads.
 */
export const alternative = (
  args: ReadonlyArray<string>,
  edit: (i: Intent) => Intent,
): string | null => {
  const tokens = render(edit(intentOf(args)))
  return wellFormed(intentOf(tokens)) ? commandLine(tokens) : null
}

/**
 * The setup steps still owed in `dir`, as a `fix` for the create or add the caller ran: without
 * the steps the caller declined (`--no-install`, `--no-git`), and null when none are left.
 */
export const finish = (
  args: ReadonlyArray<string>,
  dir: string,
  steps: ReadonlyArray<string>,
): string | null => {
  const o = intentOf(args)
  if (o.verb !== "create" && o.verb !== "add" && o.verb !== "upgrade") return null
  const v = view(o)
  if (switchOf(v, "dry-run") !== false) return null
  const install = switchOf(v, "install") !== false
  const git = o.verb !== "create" || switchOf(v, "git") !== false
  const kept = steps.filter(
    (s) =>
      !s.includes("create-efforge") &&
      (install || (s !== INSTALL && s !== FORMAT)) &&
      (git || s !== COMMIT),
  )
  return kept.length === 0 ? null : inDir(relative(process.cwd(), dir), kept)
}

// --- Edits -------------------------------------------------------------------------------

/** `i` with `--name` set to `value` (replacing every occurrence), or removed. */
export const withFlag = (i: Intent, name: string, value: string | boolean | null): Intent => {
  const verb = i.verb ?? "create"
  const matches = (f: Flag) => meantFlag(verb, f.name)?.name === name
  const at = i.flags.findIndex(matches)
  const rest = i.flags.filter((f, k) => k === at || !matches(f))
  if (value === null) return { ...i, flags: rest.filter((f) => !matches(f)) }
  const flag: Flag = { name, value }
  return at < 0
    ? { ...i, flags: [...rest, flag] }
    : { ...i, flags: rest.map((f) => (matches(f) ? flag : f)) }
}

/** `i` with the command written out as the command it names (`lst` -> `list`). */
export const spelledOut = (i: Intent): Intent | undefined =>
  i.verb === undefined ? undefined : { ...i, word: i.verb }
