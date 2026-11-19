import { Effect } from "effect"
import { sourceInfo } from "../source.ts"
import { missing, req, type Transform, withFile } from "./util.ts"

/**
 * Wraps the top-level declarations `names` (in order, with nothing else between them) in a
 * `// #region <region>` ... `// #endregion` block, the part of a file a capability card shows.
 * undefined when they aren't there, or aren't next to each other; `text` when the region exists.
 */
export const addRegionText = (
  file: string,
  text: string,
  region: string,
  names: ReadonlyArray<string>,
): string | undefined => {
  const info = sourceInfo(file, text)
  if (info.regions.has(region)) return text
  const decls = names.map((n) => info.declarations.get(n))
  if (decls.length === 0 || decls.some((d) => d === undefined)) return undefined
  const sorted = (decls as NonNullable<(typeof decls)[number]>[]).toSorted(
    (a, b) => a.start - b.start,
  )
  const first = sorted[0] as (typeof sorted)[number]
  const last = sorted.at(-1) as (typeof sorted)[number]
  // nothing of the owner's between them: the block shows in the browser
  const others = [...info.declarations.values()].filter(
    (d) => !names.includes(d.name) && d.start > first.start && d.start < last.end,
  )
  if (others.length > 0) return undefined
  // the leading comment belongs inside, as in efforge's own files
  const lineStart = text.lastIndexOf("\n", first.start - 1) + 1
  const commentStart = leadingCommentStart(text, lineStart)
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const endLine = text.indexOf("\n", last.end)
  const cut = endLine < 0 ? text.length : endLine
  return `${text.slice(0, commentStart)}// #region ${region}${eol}${text.slice(commentStart, cut)}${eol}// #endregion${text.slice(cut)}`
}

/** Where the comment lines right above `lineStart` begin (no blank line between). */
const leadingCommentStart = (text: string, lineStart: number): number => {
  let at = lineStart
  while (at > 0) {
    const prevStart = text.lastIndexOf("\n", at - 2) + 1
    const line = text.slice(prevStart, at - 1).trim()
    if (/^(\/\/|\/\*|\*)/.test(line) && !line.startsWith("// #")) at = prevStart
    else break
  }
  return at
}

/** args: `{ file, region, declarations }` (comma-separated names): see addRegionText. */
export const addRegion: Transform = (tree, args) =>
  Effect.gen(function* () {
    const file = req(args, "file", "addRegion")
    const region = req(args, "region", "addRegion")
    const names = req(args, "declarations", "addRegion")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    const snippet = `In ${file}, put these lines around ${names.join(", ")}:\n// #region ${region}\n// #endregion`
    const text = tree.get(file)
    if (text === undefined) return yield* missing(file, "file", snippet)
    const next = addRegionText(file, text, region, names)
    if (next === undefined) return yield* missing(file, names.join(", "), snippet)
    return withFile(tree, file, next)
  })
