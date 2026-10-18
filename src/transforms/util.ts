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
): string => breakIfTooLong(appendListItemRaw(text, open, close, lastEnd, item), open)

/** The formatter's line width (generated vite.config.ts `printWidth`). */
const PRINT_WIDTH = 100

/** Splits `a, (b, c), d` at top-level commas, ignoring commas in brackets, strings and comments. */
const splitTopLevel = (s: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < s.length && s[i] !== c; i++) if (s[i] === "\\") i++
    } else if (c === "/" && s[i + 1] === "*") {
      i = s.indexOf("*/", i + 2) + 1 || s.length
    } else if (c === "(" || c === "[" || c === "{") depth++
    else if (c === ")" || c === "]" || c === "}") depth--
    else if (c === "," && depth === 0) {
      parts.push(s.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(s.slice(start).trim())
  return parts.filter(Boolean)
}

/**
 * A list the formatter would break (the line is wider than the print width) is written one item
 * per line with a trailing comma, so the result is already formatted. Lists that are already
 * multi-line are left to appendListItemRaw.
 */
const breakIfTooLong = (text: string, open: number): string => {
  const lineStart = text.lastIndexOf("\n", open) + 1
  const lineEnd = text.indexOf("\n", open)
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd)
  if (line.length <= PRINT_WIDTH || line.includes("//")) return text
  const opener = text[open] as string
  const closer = opener === "[" ? "]" : opener === "{" ? "}" : opener === "(" ? ")" : undefined
  if (closer === undefined) return text
  // find the matching closer on the same line
  let depth = 0
  let end = -1
  for (let i = open; i < text.length && text[i] !== "\n"; i++) {
    if (text[i] === opener) depth++
    else if (text[i] === closer && --depth === 0) {
      end = i
      break
    }
  }
  if (end === -1) return text
  const indent = /^[ \t]*/.exec(line)?.[0] ?? ""
  const items = splitTopLevel(text.slice(open + 1, end))
  if (items.length < 1) return text
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const body = items.map((it) => `${indent}  ${it},`).join(eol)
  return `${text.slice(0, open + 1)}${eol}${body}${eol}${indent}${text.slice(end)}`
}

const appendListItemRaw = (
  text: string,
  open: number,
  close: number,
  lastEnd: number | undefined,
  item: string,
): string => {
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
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
      const nl = head.endsWith("\n") ? "" : eol
      return `${head}${nl}${pad}${item},${eol}${closeIndent ?? indent}${text.slice(close)}`
    }
    return `${text.slice(0, close)} ${item}${text.slice(close)}`
  }
  const after = text.slice(lastEnd, close)
  const comma = /^\s*,/.exec(after)
  if (!inner.includes("\n")) return `${text.slice(0, lastEnd)}, ${item}${text.slice(lastEnd)}`
  const lineStart = text.lastIndexOf("\n", lastEnd - 1) + 1
  const indent = /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? ""
  // a trailing same-line comment belongs to the previous item, so insert after it
  const trailing = (from: number) =>
    from +
    (/^[ \t]*(?:\/\/[^\r\n]*|\/\*[^\r\n]*?\*\/)?(?=[ \t]*\r?\n)/.exec(text.slice(from))?.[0]
      .length ?? 0)
  if (comma) {
    const at = trailing(lastEnd + comma[0].length)
    return `${text.slice(0, at)}${eol}${indent}${item},${text.slice(at)}`
  }
  const at = trailing(lastEnd)
  return `${text.slice(0, lastEnd)},${text.slice(lastEnd, at)}${eol}${indent}${item}${text.slice(at)}`
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
  // `import type { X }` plus `import { X }` would redeclare X, so promote it to a value import
  for (const d of decls.filter((decl) => decl.isTypeOnly())) {
    for (const n of d.getNamedImports()) {
      if (fresh.includes(n.getText())) {
        n.remove()
        added = true
      }
    }
    if (d.getNamedImports().length === 0 && d.getDefaultImport() === undefined) d.remove()
  }
  if (added) return addImportText(file, sf.getFullText(), spec, from) ?? sf.getFullText()
  if (target) {
    for (const n of fresh) target.addNamedImport(n)
    added = true
  }
  return added
    ? sf.getFullText()
    : insertImport(sf, text, `import { ${fresh.join(", ")} } from "${from}"`)
}

/** Import groups: `node:` builtins, packages, aliases (`@/`, `#`, `~`), then relative paths. */
const importRank = (from: string): number => {
  if (/^(node|bun):/.test(from)) return 0
  if (from.startsWith(".")) return from.startsWith("./") ? 5 : 4
  if (/^(@\/|#|~)/.test(from)) return 3
  return 1
}

/** Compares path segment by segment, so `effect/sql` sorts before `effect-cf`. */
const importOrder = (a: string, b: string): number => {
  const byRank = importRank(a) - importRank(b)
  if (byRank !== 0) return byRank
  const [as, bs] = [a.split("/"), b.split("/")]
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const [x, y] = [as[i] as string, bs[i] as string]
    if (x !== y) return x < y ? -1 : 1
  }
  return as.length - bs.length
}

/** Inserts before the first import that sorts after `from` (grouped by importRank), else after the last. */
const insertImport = (sf: SourceFile, text: string, stmt: string): string => {
  const decls = sf.getImportDeclarations()
  const from = /from\s+"([^"]+)"/.exec(stmt)?.[1] ?? ""
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const next = decls.find((d) => importOrder(d.getModuleSpecifierValue(), from) > 0)
  if (next !== undefined) {
    const start = next.getStart()
    return `${text.slice(0, start)}${stmt}${eol}${text.slice(start)}`
  }
  const last = decls.at(-1)
  if (last === undefined) return `${stmt}${eol}${text}`
  const end = last.getEnd()
  return `${text.slice(0, end)}${eol}${stmt}${text.slice(end)}`
}
