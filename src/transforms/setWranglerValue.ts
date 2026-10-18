import { Effect } from "effect"
import { applyEdits, modify, type ParseError, parse } from "jsonc-parser"
import { WRANGLER_FILE } from "./addWranglerBinding.ts"
import { missing, req, type Transform, withFile } from "./util.ts"

/**
 * args: `{ key, value }` — sets the dotted path `key` (e.g. `dev.enable_containers`) in
 * `wrangler.jsonc` to the JSON `value`, unless the user already set it.
 */
export const setWranglerValue: Transform = (tree, args) =>
  Effect.gen(function* () {
    const key = req(args, "key", "setWranglerValue")
    const raw = req(args, "value", "setWranglerValue")
    const snippet = `In ${WRANGLER_FILE}, set "${key}" to ${raw}`
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      return yield* missing(WRANGLER_FILE, `valid JSON value for "${key}" (got ${raw})`, snippet)
    }
    const text = tree.get(WRANGLER_FILE)
    if (text === undefined) return yield* missing(WRANGLER_FILE, "file", snippet)

    const errors: ParseError[] = []
    const doc: unknown = parse(text, errors, { allowTrailingComma: true })
    if (errors.length > 0 || typeof doc !== "object" || doc === null || Array.isArray(doc))
      return yield* missing(WRANGLER_FILE, "valid JSONC object", snippet)

    const path = key.split(".")
    let cur: unknown = doc
    for (const part of path) {
      if (typeof cur !== "object" || cur === null) break
      cur = (cur as Record<string, unknown>)[part]
    }
    if (cur !== undefined) return tree

    const edits = modify(text, path, value, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
    return withFile(tree, WRANGLER_FILE, applyEdits(text, edits))
  })
