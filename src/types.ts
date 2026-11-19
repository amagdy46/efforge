import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { Project, TypeFormatFlags } from "ts-morph"

// The type a file exports under a name, as the project's own TypeScript sees it: before and after
// an upgrade's changes. `upgrade` asks it when a file the owner wrote imports something efforge's
// new version of a file declares differently: a changed function body is fine, a changed type is
// not. It needs the project's node_modules; without them it answers undefined and the caller
// assumes the worst.

export interface TypeProbe {
  /** The exported type of `name` in `file`, on disk (`after` false) or with the plan applied. */
  readonly typeOf: (file: string, name: string, after: boolean) => string | undefined
}

const FLAGS: TypeFormatFlags =
  // oxlint-disable-next-line typescript/no-unsafe-enum-assignment -- a bit set of the enum's own flags
  TypeFormatFlags.NoTruncation |
  TypeFormatFlags.UseFullyQualifiedType |
  TypeFormatFlags.WriteArrowStyleSignature

export const typeProbe = (
  dir: string,
  changes: ReadonlyMap<string, string>,
  removes: ReadonlySet<string>,
): TypeProbe => {
  const projects = new Map<string, Project | null>()
  const tsconfigOf = (file: string): string | undefined => {
    let d = dirname(join(dir, file))
    while (d.startsWith(dir)) {
      if (existsSync(join(d, "tsconfig.json"))) return join(d, "tsconfig.json")
      const up = dirname(d)
      if (up === d) break
      d = up
    }
    return undefined
  }
  const projectFor = (file: string, after: boolean): Project | undefined => {
    const tsconfig = tsconfigOf(file)
    if (tsconfig === undefined || !existsSync(join(dir, "node_modules"))) return undefined
    const key = `${tsconfig}\0${after}`
    if (projects.has(key)) return projects.get(key) ?? undefined
    try {
      const p = new Project({ tsConfigFilePath: tsconfig, skipAddingFilesFromTsConfig: true })
      if (after) {
        for (const [f, text] of changes)
          if (/\.(?:ts|tsx)$/.test(f)) p.createSourceFile(join(dir, f), text, { overwrite: true })
        for (const f of removes) {
          const sf = p.getSourceFile(join(dir, f))
          if (sf !== undefined) p.removeSourceFile(sf)
        }
      }
      projects.set(key, p)
      return p
    } catch {
      projects.set(key, null)
      return undefined
    }
  }
  return {
    typeOf: (file, name, after) => {
      const p = projectFor(file, after)
      if (p === undefined) return undefined
      try {
        const abs = join(dir, file)
        const sf = p.getSourceFile(abs) ?? p.addSourceFileAtPathIfExists(abs)
        if (sf === undefined) return undefined
        p.resolveSourceFileDependencies()
        const decl = sf.getExportedDeclarations().get(name)?.[0]
        if (decl === undefined) return undefined
        const text = decl.getType().getText(decl, FLAGS)
        // a module it couldn't resolve makes `any`: no answer
        return /\bany\b/.test(text) ? undefined : text
      } catch {
        return undefined
      }
    },
  }
}
