import { Effect } from "effect"
import { applyEdits, modify, type ParseError, parse } from "jsonc-parser"
import { missing, req, type Transform, withFile } from "./util.ts"

export const WRANGLER_FILE = "wrangler.jsonc"

type Entry = Record<string, unknown>
const isEntry = (v: unknown): v is Entry => typeof v === "object" && v !== null && !Array.isArray(v)

const same = (a: Entry, b: unknown): boolean => {
  if (!isEntry(b)) return JSON.stringify(a) === JSON.stringify(b)
  if (a.binding !== undefined) return a.binding === b.binding
  if (a.name !== undefined) return a.name === b.name
  return JSON.stringify(a) === JSON.stringify(b)
}

/** args: `{ key, value }` — `value` is a JSON object (or array of objects) appended to the top-level `key` array. */
export const addWranglerBinding: Transform = (tree, args) =>
  Effect.gen(function* () {
    const key = req(args, "key", "addWranglerBinding")
    const raw = req(args, "value", "addWranglerBinding")
    const snippet = `In ${WRANGLER_FILE}, add to the "${key}" array:\n  ${raw}`
    const text = tree.get(WRANGLER_FILE)
    if (text === undefined) return yield* missing(WRANGLER_FILE, "file", snippet)

    const errors: ParseError[] = []
    const doc: unknown = parse(text, errors, { allowTrailingComma: true })
    if (errors.length > 0 || !isEntry(doc))
      return yield* missing(WRANGLER_FILE, "valid JSONC object", snippet)
    const existing = doc[key]
    if (existing !== undefined && !Array.isArray(existing))
      return yield* missing(WRANGLER_FILE, `"${key}" array`, snippet)

    const parsed: unknown = JSON.parse(raw)
    const incoming = Array.isArray(parsed) ? parsed : [parsed]
    const formattingOptions = { insertSpaces: true, tabSize: 2 }
    let next = text
    let current = (existing as unknown[] | undefined) ?? []
    for (const item of incoming) {
      if (current.some((e) => isEntry(item) && same(item, e))) continue
      const edits =
        current.length === 0 && existing === undefined
          ? modify(next, [key], [item], { formattingOptions })
          : modify(next, [key, -1], item, { formattingOptions, isArrayInsertion: true })
      next = applyEdits(next, edits)
      current = [...current, item]
    }
    return withFile(tree, WRANGLER_FILE, next)
  })
