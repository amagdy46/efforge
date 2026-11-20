import { Effect } from "effect"
import { sourceInfo } from "../source.ts"
import { missing, parseTs, req, type Transform, withFile } from "./util.ts"

/**
 * Puts `statement` (a top-level declaration of `name`, as efforge writes it today) in `text`: in
 * place of the existing declaration of `name`, or after the imports when there is none. Leading
 * comments of an existing declaration stay.
 */
export const setDeclarationText = (
  file: string,
  text: string,
  name: string,
  statement: string,
): string => {
  const info = sourceInfo(file, text)
  const existing = info.declarations.get(name)
  if (existing !== undefined)
    return `${text.slice(0, existing.start)}${statement.trim()}${text.slice(existing.end)}`
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const last = parseTs(file, text).getImportDeclarations().at(-1)
  if (last === undefined) return `${statement.trim()}${eol}${eol}${text}`
  const at = last.getEnd()
  return `${text.slice(0, at)}${eol}${eol}${statement.trim()}${text.slice(at)}`
}

/** args: `{ file, name, statement }`: see setDeclarationText. */
export const setDeclaration: Transform = (tree, args) =>
  Effect.gen(function* () {
    const file = req(args, "file", "setDeclaration")
    const name = req(args, "name", "setDeclaration")
    const statement = req(args, "statement", "setDeclaration")
    const text = tree.get(file)
    if (text === undefined)
      return yield* missing(file, "file", `Create ${file} with:\n${statement}`)
    return withFile(tree, file, setDeclarationText(file, text, name, statement))
  })
