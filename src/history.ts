import { releases } from "./history.data.ts"
import { decodeRecord } from "./record.ts"
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

/** True when efforge `version` has a record (a release this CLI knows). */
export const knownRelease = (version: string): boolean => Object.hasOwn(releases, version)

/** Every fingerprint the releases since `version` wrote for `file`, or undefined when none did. */
export const recordFor = (version: string, file: string): Set<number> | undefined => {
  let out: Set<number> | undefined
  for (const [, r] of releasesSince(version)) {
    const text = r.records[file]
    if (text === undefined) continue
    out ??= new Set()
    for (const x of decodeRecord(text)) out.add(x)
  }
  return out
}

/** True when a release since `version` pinned `name` at `pin`. */
export const efforgePinned = (version: string, name: string, pin: string): boolean =>
  releasesSince(version).some(([, r]) => (name === "pnpm" ? r.pnpm : r.pins[name]) === pin)

/** True when a release since `version` wrote `command` for script `name` in `file`. */
export const efforgeScript = (version: string, file: string, name: string, command: string) =>
  releasesSince(version).some(([, r]) => r.scripts[file]?.[name]?.includes(command) === true)

/**
 * True when a release since `version` wrote script `name` in `file` for a stack like `stack`: a
 * script missing now is one the owner removed. Any other is new, and `upgrade` adds it.
 */
export const efforgeWroteScript = (
  version: string,
  file: string,
  name: string,
  stack: { readonly [slot: string]: unknown },
) =>
  releasesSince(version).some(([, r]) => {
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

/** True when a release since `version` declared `dep` in `file`: missing now means removed. */
export const efforgeDeclared = (version: string, file: string, dep: string) =>
  releasesSince(version).some(([, r]) => r.dependencies[file]?.includes(dep) === true)

/** True when a release since `version` generated `file` (for some stack). */
export const efforgeGenerated = (version: string, file: string) =>
  releasesSince(version).some(([, r]) => r.records[file] !== undefined)

/** True when every release since `version` wrote no root `engines`. */
export const enginesNew = (version: string) =>
  releasesSince(version).every(([, r]) => r.engines === null)
