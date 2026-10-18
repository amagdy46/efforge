import { Effect } from "effect"
import { addImportText, missing, req, type Transform, withFile } from "./util.ts"

/** args: `{ file, import, from }` — `import` is `Name`, `A, B`, `* as NS` or `default Name`. */
export const addImport: Transform = (tree, args) =>
  Effect.gen(function* () {
    const file = req(args, "file", "addImport")
    const text = tree.get(file)
    if (text === undefined)
      return yield* missing(
        file,
        "file",
        `Create ${file} and add: import { ${args.import} } from "${args.from}"`,
      )
    const next = addImportText(
      file,
      text,
      req(args, "import", "addImport"),
      req(args, "from", "addImport"),
    )
    return next === undefined ? tree : withFile(tree, file, next)
  })
