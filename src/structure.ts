import { type ParseError, parse } from "jsonc-parser"

// Whether two versions of a file efforge edits in place say the same thing, whatever order the
// transforms put things in: `add` appends a layer, a binding or an AGENTS.md section where
// `create` puts it in slot order, so a project that ran `add` differs from a fresh render only in
// order. This is how `add` already compares its own output (`sameJsonc`), not a text diff.

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Same JSONC data and comments, ignoring formatting, key order and array order. */
export const sameJsonc = (a: string, b: string | undefined): boolean => {
  if (b === undefined) return false
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon).toSorted((x, y) => byName(JSON.stringify(x), JSON.stringify(y)))
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .toSorted(([x], [y]) => byName(x, y))
              .map(([k, x]) => [k, canon(x)]),
          )
        : v
  const read = (t: string) => {
    const errors: ParseError[] = []
    const v = parse(t, errors, { allowTrailingComma: true }) as unknown
    return errors.length > 0 ? undefined : JSON.stringify(canon(v))
  }
  // comments are user content too, and the parser drops them
  const comments = (t: string) =>
    (t.match(/\/\/.*$|\/\*[\s\S]*?\*\//gm) ?? [])
      .map((c) => c.trim())
      .toSorted()
      .join("\n")
  const x = read(a)
  return x !== undefined && x === read(b) && comments(a) === comments(b)
}

/** The lines of `text`, trimmed, without a trailing comma, blank ones dropped, sorted. */
const lines = (text: string) =>
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim().replace(/,$/, ""))
    .filter((l) => l !== "")
    .toSorted()
    .join("\n")

/**
 * True when `a` and `b` hold the same things in another order: the same JSONC data, or the same
 * lines (a layer one line up, an AGENTS.md section before another). Any line added, removed or
 * changed counts.
 */
export const sameStructure = (path: string, a: string, b: string): boolean =>
  /\.jsonc?$/.test(path) ? sameJsonc(a, b) : lines(a) === lines(b)
