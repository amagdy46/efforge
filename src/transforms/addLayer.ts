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

/** args: `{ file, import, from, layer }` — appends `layer` to `export const AppLayer = Layer.mergeAll(...)`. */
export const addLayer: Transform = (tree, args) =>
  Effect.gen(function* () {
    const file = req(args, "file", "addLayer")
    const spec = req(args, "import", "addLayer")
    const from = req(args, "from", "addLayer")
    const layer = req(args, "layer", "addLayer")
    const snippet = `In ${file}:\n  import { ${spec} } from "${from}"\n  export const AppLayer = Layer.mergeAll(/* ... */ ${layer})`
    const text = tree.get(file)
    if (text === undefined) return yield* missing(file, "file", snippet)

    const sf = parseTs(file, text)
    const call = sf
      .getVariableDeclaration("AppLayer")
      ?.getInitializer()
      ?.asKind(SyntaxKind.CallExpression)
    if (call === undefined || call.getExpression().getText() !== "Layer.mergeAll")
      return yield* missing(file, "AppLayer = Layer.mergeAll(...)", snippet)

    const callArgs = call.getArguments()
    let next = text
    if (!callArgs.some((a) => norm(a.getText()) === norm(layer))) {
      const open = text.indexOf("(", call.getExpression().getEnd())
      const close = call.getEnd() - 1
      next = appendListItem(text, open, close, callArgs.at(-1)?.getEnd(), layer)
    }
    next = addImportText(file, next, spec, from) ?? next
    return withFile(tree, file, next)
  })
