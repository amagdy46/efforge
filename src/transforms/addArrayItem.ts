import { Effect } from "effect"
import { SyntaxKind } from "ts-morph"
import {
  addImportText,
  appendListItem,
  missing,
  parseTs,
  req,
  type Transform,
  withFile,
} from "./util.ts"

const norm = (s: string) => s.replace(/\s+/g, "")

/**
 * args: `{ file, name, item, import?, from? }` — appends `item` to the array literal assigned to the
 * top-level `const name`, and adds `import` from `from` when both are given.
 */
export const addArrayItem: Transform = (tree, args) =>
  Effect.gen(function* () {
    const file = req(args, "file", "addArrayItem")
    const name = req(args, "name", "addArrayItem")
    const item = req(args, "item", "addArrayItem")
    const snippet = `In ${file}:\n  export const ${name} = [/* ... */ ${item}]`
    const text = tree.get(file)
    if (text === undefined) return yield* missing(file, "file", snippet)

    const array = parseTs(file, text)
      .getVariableDeclaration(name)
      ?.getInitializer()
      ?.asKind(SyntaxKind.ArrayLiteralExpression)
    if (array === undefined) return yield* missing(file, `${name} = [...]`, snippet)

    const elements = array.getElements()
    let next = text
    if (!elements.some((e) => norm(e.getText()) === norm(item)))
      next = appendListItem(
        text,
        array.getStart(),
        array.getEnd() - 1,
        elements.at(-1)?.getEnd(),
        item,
      )
    if (args.import !== undefined && args.from !== undefined)
      next = addImportText(file, next, args.import, args.from) ?? next
    return withFile(tree, file, next)
  })
