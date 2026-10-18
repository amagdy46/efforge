import { Effect } from "effect"
import { missing, parseTs, req, type Transform, withFile } from "./util.ts"

/**
 * args: `{ file, export, from }` — `export` is `*` or `A, B`; appends `export { A, B } from "from"`
 * (or `export * from "from"`) to `file`, merging names into an existing re-export from the same module.
 */
export const addExport: Transform = (tree, args) =>
  Effect.gen(function* () {
    const file = req(args, "file", "addExport")
    const spec = req(args, "export", "addExport").trim()
    const from = req(args, "from", "addExport")
    const text = tree.get(file)
    if (text === undefined)
      return yield* missing(
        file,
        "file",
        `Create ${file} and add: export { ${spec} } from "${from}"`,
      )

    const sf = parseTs(file, text)
    const decls = sf.getExportDeclarations().filter((d) => d.getModuleSpecifierValue() === from)
    if (spec === "*") {
      // `export type * from` re-exports no values, so it doesn't satisfy `export *`
      if (
        decls.some(
          (d) => !d.isTypeOnly() && d.isNamespaceExport() && d.getNamespaceExport() === undefined,
        )
      )
        return tree
      return withFile(tree, file, append(text, `export * from "${from}"`))
    }

    const names = spec
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    const target = decls.find((d) => !d.isTypeOnly() && !d.isNamespaceExport())
    const have = new Set(
      decls
        .filter((d) => !d.isTypeOnly())
        .flatMap((d) =>
          d
            .getNamedExports()
            .filter((n) => !n.isTypeOnly())
            .map((n) => n.getAliasNode()?.getText() ?? n.getName()),
        ),
    )
    const fresh = names.filter((n) => !have.has(n.split(/\s+as\s+/).at(-1) as string))
    if (fresh.length === 0) return tree
    if (target !== undefined) {
      for (const n of fresh) target.addNamedExport(n)
      return withFile(tree, file, sf.getFullText())
    }
    return withFile(tree, file, append(text, `export { ${fresh.join(", ")} } from "${from}"`))
  })

const append = (text: string, stmt: string): string => {
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  return `${text}${text.endsWith("\n") || text === "" ? "" : eol}${stmt}${eol}`
}
