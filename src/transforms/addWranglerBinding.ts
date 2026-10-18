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

/** Value at a dotted path (`durable_objects.bindings`), or undefined; `null` when a parent is not an object. */
const lookup = (doc: Entry, path: string[]): unknown => {
  let cur: unknown = doc
  for (const part of path) {
    if (cur === undefined) return undefined
    if (!isEntry(cur)) return null
    cur = cur[part]
  }
  return cur
}

/**
 * args: `{ key, value }` — `value` is a JSON object (or array of objects) appended to the array at
 * `key`, a top-level key or a dotted path such as `durable_objects.bindings`. Missing parents are created.
 */
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
    const path = key.split(".")
    const existing = lookup(doc, path)
    if (existing === null || (existing !== undefined && !Array.isArray(existing)))
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
          ? modify(next, path, [item], { formattingOptions })
          : modify(next, [...path, -1], item, { formattingOptions, isArrayInsertion: true })
      next = applyEdits(next, edits)
      current = [...current, item]
    }
    return withFile(tree, WRANGLER_FILE, next)
  })
