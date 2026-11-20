import { releases } from "./history.data.ts"
import { decodeRecord, shingles } from "./record.ts"
import { compareVersions, exactVersion } from "./semver.ts"

// What each efforge release generated, so `upgrade` can tell its own older output from an owner's
// choice where it has no hash: a pin, a script or a dependency equal to what a release wrote is
// efforge's to move; anything else is the owner's. Written by scripts/history.ts at each release
// (docs/decisions/0011-upgrade-applies-what-efforge-can-prove.md).

export interface Release {
  /** The pnpm `packageManager` pinned. */
  readonly pnpm: string | null
  /** Every pin of src/versions.ts. */
  readonly pins: Readonly<Record<string, string>>
  /** Root package.json `engines`, or null when the release wrote none. */
  readonly engines: unknown
  /** package.json path -> every dependency it declared, for any stack. */
  readonly dependencies: Readonly<Record<string, ReadonlyArray<string>>>
  /** package.json path -> script -> every command it wrote, for any stack. */
  readonly scripts: Readonly<Record<string, Readonly<Record<string, ReadonlyArray<string>>>>>
  /**
   * package.json path -> script -> the stacks that got it, when only some did: for each slot that
   * narrows it, the values of those stacks; for `extras`, the extras each of them had (a project
   * with any of them counts). Absent for entries recorded before it existed.
   */
  readonly scriptStacks?: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, ReadonlyArray<string>>>>>>
  >
  /** File efforge edits in place -> its fingerprint record (src/record.ts), for any stack. */
  readonly records: Readonly<Record<string, string>>
}

export { releases }

/**
 * The releases a project's own output can come from: the one that made (or last upgraded) it and
 * every later one, up to this CLI (an `add` run by a newer efforge writes that release's pins).
 * An unknown version counts every release from the newest one before it.
 */
export const releasesSince = (version: string): ReadonlyArray<readonly [string, Release]> => {
  const all = Object.entries(releases).toSorted(([a], [b]) => compareVersions(a, b))
  const v = exactVersion(version)
  if (v === undefined) return all
  const from = all.findLastIndex(([r]) => compareVersions(r, v) <= 0)
  return all.slice(Math.max(0, from))
}

/**
 * The release a project itself got: the one that made (or last upgraded) it, the newest record at
 * or before `version`. "Missing now means you removed it" is judged against this one alone. What a
 * later release added, this CLI's own output included once it is recorded, is new to the project,
 * not something its owner took out. (An `add` run by a newer efforge can write a later release's
 * lines; one of those the owner removed is put back, which is the safe direction.)
 */
export const ownRelease = (version: string): ReadonlyArray<readonly [string, Release]> =>
  releasesSince(version).slice(0, 1)

/** True when efforge `version` has a record (a release this CLI knows). */
export const knownRelease = (version: string): boolean => Object.hasOwn(releases, version)

const recordOf = (
  list: ReadonlyArray<readonly [string, Release]>,
  file: string,
): Set<number> | undefined => {
  let out: Set<number> | undefined
  for (const [, r] of list) {
    const text = r.records[file]
    if (text === undefined) continue
    out ??= new Set()
    for (const x of decodeRecord(text)) out.add(x)
  }
  return out
}

/** Every fingerprint the releases since `version` wrote for `file`, or undefined when none did. */
export const recordFor = (version: string, file: string): Set<number> | undefined =>
  recordOf(releasesSince(version), file)

/**
 * The record of the release whose output `disk` is, for a file efforge edits in place (it has no
 * hash to say): the release that wrote the most of it, the newest on a tie. A file `upgrade` held
 * back keeps an older release's text after the project's version moved on, so the project's
 * version can't say which release a file came from; what is missing from it is judged against
 * this one. Undefined when no release wrote the file.
 */
export const sourceRecordFor = (
  file: string,
  disk: string,
  name?: string,
): Set<number> | undefined => {
  const runs = shingles(disk, name)
  let best: Set<number> | undefined
  let fewest = Number.POSITIVE_INFINITY
  for (const [, r] of Object.entries(releases).toSorted(([a], [b]) => compareVersions(a, b))) {
    const text = r.records[file]
    if (text === undefined) continue
    const record = decodeRecord(text)
    let missing = 0
    for (const x of runs) if (!record.has(x)) missing++
    if (missing <= fewest) {
      best = record
      fewest = missing
    }
  }
  return best
}

/** True when a release since `version` pinned `name` at `pin`. */
export const efforgePinned = (version: string, name: string, pin: string): boolean =>
  releasesSince(version).some(([, r]) => (name === "pnpm" ? r.pnpm : r.pins[name]) === pin)

/** True when a release since `version` wrote `command` for script `name` in `file`. */
export const efforgeScript = (version: string, file: string, name: string, command: string) =>
  releasesSince(version).some(([, r]) => r.scripts[file]?.[name]?.includes(command) === true)

/**
 * True when the project's own release wrote script `name` in `file` for a stack like `stack`: a
 * script missing now is one the owner removed. Any other is new, and `upgrade` adds it.
 */
export const efforgeWroteScript = (
  version: string,
  file: string,
  name: string,
  stack: { readonly [slot: string]: unknown },
) =>
  ownRelease(version).some(([, r]) => {
    if (r.scripts[file]?.[name] === undefined) return false
    const only = r.scriptStacks?.[file]?.[name]
    if (only === undefined) return true
    return Object.entries(only).every(([slot, values]) => {
      const mine = stack[slot]
      return Array.isArray(mine)
        ? mine.some((x) => values.includes(String(x)))
        : values.includes(String(mine))
    })
  })

/** True when the project's own release declared `dep` in `file`: missing now means removed. */
export const efforgeDeclared = (version: string, file: string, dep: string) =>
  ownRelease(version).some(([, r]) => r.dependencies[file]?.includes(dep) === true)

/** True when the project's own release generated `file` (for some stack): missing means removed. */
export const efforgeGenerated = (version: string, file: string) =>
  ownRelease(version).some(([, r]) => r.records[file] !== undefined)

/** True when the project's own release wrote no root `engines`. */
export const enginesNew = (version: string) =>
  ownRelease(version).every(([, r]) => r.engines === null)
