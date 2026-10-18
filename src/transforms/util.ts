import type { Effect } from "effect"
import { Project, type SourceFile } from "ts-morph"
import type { Tree } from "../tree.ts"
import { TransformAnchorMissing } from "./errors.ts"

export type Args = Readonly<Record<string, string>>
export type Transform = (tree: Tree, args: Args) => Effect.Effect<Tree, TransformAnchorMissing>

/** Required argument; a missing one is a bug in the add-on manifest, so it is a defect. */
export const req = (args: Args, key: string, transform: string): string => {
  const v = args[key]
  if (v === undefined) throw new Error(`transform ${transform}: missing arg "${key}"`)
  return v
}

export const missing = (file: string, anchor: string, snippet: string) =>
  new TransformAnchorMissing({ file, anchor, snippet })

/** Returns `tree` itself when nothing changed, so repeated runs are identical. */
export const withFile = (tree: Tree, file: string, text: string): Tree =>
  tree.get(file) === text ? tree : new Map(tree).set(file, text)

let project: Project | undefined
export const parseTs = (file: string, text: string): SourceFile => {
  project ??= new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  })
  return project.createSourceFile(`/${file}`, text, { overwrite: true })
}

/**
 * Appends `item` to a bracketed list (call arguments, array elements, object properties).
 * `open`/`close` are the positions of the delimiters, `lastEnd` the end of the last item.
 * Works on the raw text so user formatting, comments and trailing commas survive.
 */
export const appendListItem = (
  text: string,
  open: number,
  close: number,
  lastEnd: number | undefined,
  item: string,
): string => {
  const inner = text.slice(open + 1, close)
  if (lastEnd === undefined) {
    if (inner.trim() === "") {
      const pad = text[open] === "{" ? " " : ""
      return `${text.slice(0, open + 1)}${pad}${item}${pad}${text.slice(close)}`
    }
    if (inner.includes("//") || inner.includes("\n")) {
      const lineStart = text.lastIndexOf("\n", open) + 1
      const indent = /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? ""
      const closeIndent = /\n([ \t]*)$/.exec(inner)?.[1]
      const pad = closeIndent === undefined ? `${indent}  ` : `${closeIndent}  `
      const head = text.slice(0, close).replace(/[ \t]*$/, "")
      const nl = head.endsWith("\n") ? "" : "\n"
      return `${head}${nl}${pad}${item},\n${closeIndent ?? indent}${text.slice(close)}`
    }
    return `${text.slice(0, close)} ${item}${text.slice(close)}`
  }
  const after = text.slice(lastEnd, close)
  const comma = /^\s*,/.exec(after)
  if (!inner.includes("\n")) return `${text.slice(0, lastEnd)}, ${item}${text.slice(lastEnd)}`
  const lineStart = text.lastIndexOf("\n", lastEnd - 1) + 1
  const indent = /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? ""
  if (comma) {
    const at = lastEnd + comma[0].length
    return `${text.slice(0, at)}\n${indent}${item},${text.slice(at)}`
  }
  return `${text.slice(0, lastEnd)},\n${indent}${item}${text.slice(lastEnd)}`
}

/** Adds `spec` (`Name`, `A, B as C`, `* as NS` or `default Name`) from `from`; undefined if already imported. */
export const addImportText = (
  file: string,
  text: string,
  spec: string,
  from: string,
): string | undefined => {
  const sf = parseTs(file, text)
  const decls = sf.getImportDeclarations().filter((d) => d.getModuleSpecifierValue() === from)
  const ns = /^\*\s+as\s+(\w+)$/.exec(spec.trim())
  const def = /^default\s+(\w+)$/.exec(spec.trim())
  let added = false
  if (ns?.[1] !== undefined) {
    const name = ns[1]
    if (decls.some((d) => d.getNamespaceImport()?.getText() === name)) return undefined
    return insertImport(sf, text, `import * as ${name} from "${from}"`)
  }
  if (def?.[1] !== undefined) {
    const name = def[1]
    if (decls.some((d) => d.getDefaultImport()?.getText() === name)) return undefined
    return insertImport(sf, text, `import ${name} from "${from}"`)
  }
  const names = spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const target = decls.find((d) => !d.isTypeOnly() && d.getNamespaceImport() === undefined)
  const have = new Set(
    decls
      .filter((d) => !d.isTypeOnly())
      .flatMap((d) => d.getNamedImports().map((n) => n.getAliasNode()?.getText() ?? n.getName())),
  )
  const fresh = names.filter((n) => !have.has(n.split(/\s+as\s+/).at(-1) as string))
  if (fresh.length === 0) return undefined
  if (target) {
    for (const n of fresh) target.addNamedImport(n)
    added = true
  }
  return added
    ? sf.getFullText()
    : insertImport(sf, text, `import { ${fresh.join(", ")} } from "${from}"`)
}

const insertImport = (sf: SourceFile, text: string, stmt: string): string => {
  const last = sf.getImportDeclarations().at(-1)
  if (last === undefined) return `${stmt}\n${text}`
  const end = last.getEnd()
  return `${text.slice(0, end)}\n${stmt}${text.slice(end)}`
}
