import { Node, SyntaxKind } from "ts-morph"
import { parseTs } from "./transforms/util.ts"

// What `upgrade` needs to know about a TypeScript file to keep a project consistent: what it
// imports from where (names, and `?region=` blocks), what it exports, and the text of each
// top-level declaration. Read with ts-morph, so comments and formatting don't count.

export interface ImportEdge {
  /** The module specifier without its query (`@/server/greeting`, `../layers.ts`). */
  readonly spec: string
  /** `card` for `?region=card`. */
  readonly region?: string
  /** Named and default (`default`) imports; empty for a namespace or side-effect import. */
  readonly names: ReadonlyArray<string>
  /** True for `import * as` or `export * from`: every export is used. */
  readonly all: boolean
}

export interface Declaration {
  readonly name: string
  /** A type (interface, type alias) or a value (const, function, class, enum). */
  readonly kind: "type" | "value"
  /** The statement, comments and whitespace aside. */
  readonly text: string
  /** What callers see of a value: parameters and declared types; the text for a type. */
  readonly signature: string
  /** Identifiers it mentions, for the declarations it depends on. */
  readonly refs: ReadonlySet<string>
  /** The statement as written, from its leading comments to its end. */
  readonly start: number
  readonly end: number
}

export interface SourceInfo {
  readonly imports: ReadonlyArray<ImportEdge>
  /** Names this file exports itself (`export const`, `export { a }`, `export default`). */
  readonly exports: ReadonlySet<string>
  /** `export * from` specifiers, whose exports are this file's too. */
  readonly reexports: ReadonlyArray<string>
  /** `export { a } from "x"`: name -> specifier. */
  readonly forwarded: ReadonlyMap<string, string>
  readonly declarations: ReadonlyMap<string, Declaration>
  /** `// #region <name>` ... `// #endregion` blocks. */
  readonly regions: ReadonlySet<string>
}

/** Collapses whitespace and drops comments, so formatting doesn't count. */
export const normalize = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}()[\],;:<>=|&?.])\s*/g, "$1")
    .replace(/,([}\])>])/g, "$1")
    .trim()

/** The `// #region` blocks of `text` that have an `// #endregion` after them. */
export const regionsOf = (text: string): Set<string> => {
  const out = new Set<string>()
  const lines = text.split("\n")
  lines.forEach((line, i) => {
    const m = /^\s*\/\/ #region (\S+)\s*$/.exec(line)
    if (m !== null && lines.slice(i + 1).some((l) => /^\s*\/\/ #endregion\b/.test(l)))
      out.add(m[1] as string)
  })
  return out
}

const splitQuery = (spec: string): { spec: string; region?: string } => {
  const q = spec.indexOf("?")
  if (q < 0) return { spec }
  const region = /[?&]region=([\w-]+)/.exec(spec.slice(q))?.[1]
  return region === undefined ? { spec: spec.slice(0, q) } : { spec: spec.slice(0, q), region }
}

const cache = new Map<string, SourceInfo>()

const declarationOf = (node: Node, name: string, kind: "type" | "value"): Declaration => {
  const ids = new Set(
    node
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .map((i) => i.getText())
      .filter((t) => t !== name),
  )
  let signature = normalize(node.getText())
  if (kind === "value") {
    const fn = Node.isFunctionDeclaration(node)
      ? node
      : Node.isVariableDeclaration(node)
        ? (node.getInitializer()?.asKind(SyntaxKind.ArrowFunction) ??
          node.getInitializer()?.asKind(SyntaxKind.FunctionExpression))
        : undefined
    if (fn !== undefined)
      signature = normalize(
        `(${fn
          .getParameters()
          .map((p) => p.getText())
          .join(",")})=>${fn.getReturnTypeNode()?.getText() ?? ""}`,
      )
    else if (Node.isVariableDeclaration(node))
      signature = normalize(node.getTypeNode()?.getText() ?? "")
  }
  const statement = Node.isVariableDeclaration(node)
    ? (node.getFirstAncestorByKind(SyntaxKind.VariableStatement) ?? node)
    : node
  return {
    name,
    kind,
    text: normalize(statement.getText()),
    signature,
    refs: ids,
    start: statement.getFullStart() + statement.getLeadingTriviaWidth(),
    end: statement.getEnd(),
  }
}

/** Reads `text` (a .ts or .tsx file at `file`); cached by content. */
export const sourceInfo = (file: string, text: string): SourceInfo => {
  const key = `${file}\0${text}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const sf = parseTs(file, text)
  const imports: ImportEdge[] = []
  const exports = new Set<string>()
  const reexports: string[] = []
  const forwarded = new Map<string, string>()
  const declarations = new Map<string, Declaration>()
  for (const d of sf.getImportDeclarations()) {
    const { spec, region } = splitQuery(d.getModuleSpecifierValue())
    // `import source from "./x.ts?region=card"` is the block's text, not the module's exports
    const names =
      region !== undefined
        ? []
        : [
            ...(d.getDefaultImport() === undefined ? [] : ["default"]),
            ...d.getNamedImports().map((n) => n.getName()),
          ]
    imports.push({
      spec,
      ...(region === undefined ? {} : { region }),
      names,
      all: d.getNamespaceImport() !== undefined,
    })
  }
  for (const d of sf.getExportDeclarations()) {
    const from = d.getModuleSpecifierValue()
    if (from === undefined) {
      for (const n of d.getNamedExports()) exports.add(n.getAliasNode()?.getText() ?? n.getName())
      continue
    }
    const { spec } = splitQuery(from)
    if (d.isNamespaceExport() && d.getNamespaceExport() === undefined) {
      reexports.push(spec)
      imports.push({ spec, names: [], all: true })
      continue
    }
    const ns = d.getNamespaceExport()
    if (ns !== undefined) {
      exports.add(ns.getName())
      imports.push({ spec, names: [], all: true })
      continue
    }
    const names: string[] = []
    for (const n of d.getNamedExports()) {
      const as = n.getAliasNode()?.getText() ?? n.getName()
      exports.add(as)
      forwarded.set(as, spec)
      names.push(n.getName())
    }
    imports.push({ spec, names, all: false })
  }
  // dynamic imports with a literal: `import("./x")`
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue
    const arg = call.getArguments()[0]
    if (arg !== undefined && Node.isStringLiteral(arg)) {
      const { spec, region } = splitQuery(arg.getLiteralValue())
      imports.push({ spec, ...(region === undefined ? {} : { region }), names: [], all: true })
    }
  }
  for (const s of sf.getStatements()) {
    if (Node.isVariableStatement(s)) {
      for (const v of s.getDeclarations()) {
        const name = v.getName()
        declarations.set(name, declarationOf(v, name, "value"))
        if (s.isExported()) exports.add(name)
      }
    } else if (
      Node.isFunctionDeclaration(s) ||
      Node.isClassDeclaration(s) ||
      Node.isEnumDeclaration(s) ||
      Node.isInterfaceDeclaration(s) ||
      Node.isTypeAliasDeclaration(s)
    ) {
      const name = s.getName()
      if (name === undefined) {
        if (s.isDefaultExport()) exports.add("default")
        continue
      }
      const kind =
        Node.isInterfaceDeclaration(s) || Node.isTypeAliasDeclaration(s) ? "type" : "value"
      declarations.set(name, declarationOf(s, name, kind))
      if (s.isExported()) exports.add(s.isDefaultExport() ? "default" : name)
    } else if (Node.isExportAssignment(s)) exports.add("default")
  }
  const info: SourceInfo = {
    imports,
    exports,
    reexports,
    forwarded,
    declarations,
    regions: regionsOf(text),
  }
  if (cache.size > 2000) cache.clear()
  cache.set(key, info)
  return info
}

/**
 * The declarations of `info` that `names` need, following what each mentions within the file:
 * `makeAuth` brings `AuthSettings` when its parameters use it.
 */
export const closure = (info: SourceInfo, names: Iterable<string>): Declaration[] => {
  const seen = new Set<string>()
  const out: Declaration[] = []
  const visit = (name: string) => {
    if (seen.has(name)) return
    seen.add(name)
    const d = info.declarations.get(name)
    if (d === undefined) return
    out.push(d)
    for (const r of d.refs) if (info.declarations.has(r)) visit(r)
  }
  for (const n of names) visit(n)
  return out
}
