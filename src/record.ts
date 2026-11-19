// What efforge generated for a file it edits in place, kept as a set of short fingerprints so a
// later efforge can tell its own older output from an owner's change (src/history.ts).
//
// A file is cut into tokens (words and single punctuation marks, so line breaks and indentation
// don't count) and each run of SPAN tokens is hashed to 24 bits. A formatter that rewraps a comment
// or breaks a long list keeps every run; a line the owner adds brings runs no efforge release
// wrote. The project's name is replaced first, so records from any project name match.

const SPAN = 5

/** Stands for the project's name in records, so a record matches whatever the project is called. */
const NAME = "efforgeprojectname"

const tokens = (text: string, name: string | undefined): string[] => {
  const t = name === undefined || name === "" ? text : text.split(name).join(NAME)
  return t.match(/[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g) ?? []
}

/** FNV-1a over the run, folded to 24 bits. */
const fingerprint = (run: ReadonlyArray<string>): number => {
  let h = 0x811c9dc5
  for (const s of run) {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    h ^= 0x1f // a separator, so `ab c` and `a bc` differ
    h = Math.imul(h, 0x01000193)
  }
  return ((h >>> 0) ^ (h >>> 24)) & 0xffffff
}

/** The fingerprints of the runs of SPAN tokens in `text`, in order (one run when it is shorter). */
const runs = (text: string, name?: string): number[] => {
  const t = tokens(text, name)
  if (t.length === 0) return []
  if (t.length < SPAN) return [fingerprint(t)]
  const out: number[] = []
  for (let i = 0; i + SPAN <= t.length; i++) out.push(fingerprint(t.slice(i, i + SPAN)))
  return out
}

/** The fingerprints of every run of SPAN tokens in `text` (one run when it is shorter). */
export const shingles = (text: string, name?: string): Set<number> => new Set(runs(text, name))

/** A set of fingerprints as base64 (3 bytes each, sorted), for src/history.ts. */
export const encodeRecord = (set: ReadonlySet<number>): string => {
  const sorted = [...set].toSorted((a, b) => a - b)
  const bytes = new Uint8Array(sorted.length * 3)
  sorted.forEach((n, i) => {
    bytes[i * 3] = (n >>> 16) & 0xff
    bytes[i * 3 + 1] = (n >>> 8) & 0xff
    bytes[i * 3 + 2] = n & 0xff
  })
  return Buffer.from(bytes).toString("base64")
}

export const decodeRecord = (text: string): Set<number> => {
  const bytes = Buffer.from(text, "base64")
  const out = new Set<number>()
  for (let i = 0; i + 2 < bytes.length; i += 3)
    out.add(
      ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number),
    )
  return out
}

/**
 * How `disk` relates to `today` (efforge's render now) given `record` (every fingerprint the
 * releases since the project's own wrote for this file), or undefined when there is no record:
 *
 * - `current`: the same tokens in the same runs (formatting aside)
 * - `refresh`: everything on disk that today lacks is efforge's older output, and nothing an older
 *   release wrote that today still has is missing: an older efforge's file, unedited
 * - `yours`: the owner added to it, and it has everything today's has
 * - `review`: the owner changed it and today's differs too (or, without a record, any difference)
 *
 * "Missing" means a stretch of at least SPAN runs in a row, which is what removing even one token
 * leaves; a single run is a phrase today's file also uses somewhere an older one didn't.
 */
export const compareWithRecord = (
  disk: string,
  today: string,
  record: ReadonlySet<number> | undefined,
  name?: string,
): "current" | "refresh" | "yours" | "review" => {
  const d = shingles(disk, name)
  const todayRuns = runs(today, name)
  const t = new Set(todayRuns)
  const onlyDisk = [...d].filter((x) => !t.has(x))
  const onlyToday = [...t].filter((x) => !d.has(x))
  if (onlyDisk.length === 0 && onlyToday.length === 0) return "current"
  if (
    record !== undefined &&
    onlyDisk.every((x) => record.has(x)) &&
    !removed(todayRuns, d, record)
  )
    return "refresh"
  if (onlyToday.length === 0) return "yours"
  return "review"
}

/** True when SPAN runs in a row of today's file are ones a release wrote and the disk lacks. */
const removed = (
  todayRuns: ReadonlyArray<number>,
  disk: ReadonlySet<number>,
  record: ReadonlySet<number>,
) => {
  let streak = 0
  for (const x of todayRuns) {
    streak = !disk.has(x) && record.has(x) ? streak + 1 : 0
    if (streak >= SPAN) return true
  }
  return false
}

/** True when every fingerprint of `text` that `today` lacks is one a release wrote: efforge's own. */
export const onlyEfforgeOwn = (
  text: string,
  today: string,
  record: ReadonlySet<number> | undefined,
  name?: string,
): boolean => {
  if (record === undefined) return false
  const t = shingles(today, name)
  return [...shingles(text, name)].every((x) => t.has(x) || record.has(x))
}
