import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"

// Whether a project's dependencies are installed as its package.json files declare them, read
// from the project itself: no marker that a manual install wouldn't clear. pnpm writes what it
// installed to node_modules/.pnpm/lock.yaml (its "current lockfile"); the declared side is every
// workspace package.json and pnpm-workspace.yaml's catalog and overrides.

type Deps = Record<string, string>
const depFields = ["dependencies", "devDependencies", "optionalDependencies"] as const

const readText = (file: string): string | undefined => {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return undefined
  }
}

const readJson = (file: string): Record<string, unknown> | undefined => {
  const text = readText(file)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return undefined
  }
}

const mtime = (file: string): number | undefined => {
  try {
    return statSync(file).mtimeMs
  } catch {
    return undefined
  }
}

/** A scalar as text: what a specifier or version in YAML or JSON is. */
const text = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : ""

const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** The workspace: `.` and every directory a `packages` glob of pnpm-workspace.yaml matches. */
const importers = (dir: string, workspace: Record<string, unknown>): string[] => {
  const globs = Array.isArray(workspace.packages) ? (workspace.packages as unknown[]) : []
  const out = ["."]
  for (const g of globs) {
    if (typeof g !== "string") continue
    const pattern = g.replace(/\/+$/, "")
    if (pattern.endsWith("/*")) {
      const parent = pattern.slice(0, -2)
      try {
        for (const e of readdirSync(join(dir, parent), { withFileTypes: true }))
          if (e.isDirectory() && existsSync(join(dir, parent, e.name, "package.json")))
            out.push(`${parent}/${e.name}`)
      } catch {}
    } else if (!pattern.includes("*") && existsSync(join(dir, pattern, "package.json")))
      out.push(pattern)
  }
  return out
}

/** What `name: specifier` pairs an importer of the current lockfile installed. */
const lockDeps = (entry: Record<string, unknown>, field: string): Deps =>
  Object.fromEntries(
    Object.entries(record(entry[field])).map(([name, v]) => [name, text(record(v).specifier)]),
  )

const sameDeps = (a: Deps, b: Deps) => {
  const ka = Object.keys(a).toSorted()
  const kb = Object.keys(b).toSorted()
  return ka.join("\0") === kb.join("\0") && ka.every((k) => a[k] === b[k])
}

/**
 * True when `dir` has an install (node_modules/.modules.yaml) that doesn't match what its
 * package.json files and pnpm-workspace.yaml declare: a dependency an `add` wrote whose install
 * failed, was stopped or skipped. False when nothing is installed at all (that is `installed`),
 * and false whenever it can't tell, so a healthy project is never told it owes an install.
 */
export const installOwed = (dir: string): boolean => {
  const modules = mtime(join(dir, "node_modules", ".modules.yaml"))
  if (modules === undefined) return false
  const workspaceFile = join(dir, "pnpm-workspace.yaml")
  let workspace: Record<string, unknown> = {}
  try {
    workspace = record(parse(readText(workspaceFile) ?? ""))
  } catch {
    return false
  }
  const dirs = importers(dir, workspace)
  const lockText = readText(join(dir, "node_modules", ".pnpm", "lock.yaml"))
  if (lockText === undefined) {
    // no current lockfile (an install by something other than pnpm): a manifest written after
    // the last install is the only sign left
    const declared = [workspaceFile, ...dirs.map((d) => join(dir, d, "package.json"))]
    return declared.some((f) => (mtime(f) ?? 0) > modules)
  }
  let lock: Record<string, unknown>
  try {
    // everything needed comes before `packages:`, which is most of the file
    const head = lockText.split(/^packages:/m)[0] ?? lockText
    lock = record(parse(head))
  } catch {
    return false
  }
  const catalog = record(workspace.catalog)
  const lockCatalog = record(record(lock.catalogs).default)
  const installedImporters = record(lock.importers)
  // the lockfile records overrides, and `catalog:` in them, resolved
  const declaredOverrides = Object.fromEntries(
    Object.entries(record(workspace.overrides)).map(([k, v]) => [
      k,
      text(v) === "catalog:" ? text(catalog[k]) : text(v),
    ]),
  )
  /** `effect@>=4` and `@effect/sql-*` name the packages they override. */
  const overridden = (name: string): string[] =>
    Object.entries(declaredOverrides)
      .filter(([key]) => {
        const at = key.indexOf("@", 1)
        const pattern = at < 0 ? key : key.slice(0, at)
        return pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : pattern === name
      })
      .map(([, v]) => v)
  for (const d of dirs) {
    const pkg = readJson(join(dir, d, "package.json"))
    if (pkg === undefined) return false
    const entry = record(installedImporters[d])
    for (const field of depFields) {
      const declared = Object.fromEntries(
        Object.entries(record(pkg[field])).map(([k, v]) => [k, text(v)]),
      )
      const installed = lockDeps(entry, field)
      const names = (x: Deps) => Object.keys(x).toSorted().join("\0")
      if (names(declared) !== names(installed)) return true
      for (const [name, spec] of Object.entries(declared)) {
        const got = installed[name] as string
        if (got === spec) {
          if (
            spec === "catalog:" &&
            text(record(lockCatalog[name]).specifier) !== text(catalog[name])
          )
            return true
        } else if (!overridden(name).includes(got)) return true
      }
    }
  }
  const installedOverrides = Object.fromEntries(
    Object.entries(record(lock.overrides)).map(([k, v]) => [k, text(v)]),
  )
  if (!sameDeps(declaredOverrides, installedOverrides)) return true
  // pnpm-lock.yaml moved on (a teammate's lockfile-only bump): what it resolves differs from
  // what was installed
  const wanted = lockfileImporters(readText(join(dir, "pnpm-lock.yaml")))
  return wanted !== undefined && wanted !== lockfileImporters(lockText)
}

/**
 * Each importer's dependencies with the versions they resolved to, as one string, from a pnpm
 * lockfile (the project's, or the copy pnpm keeps of what it installed); undefined when unreadable.
 * pnpm-lock.yaml can hold two documents (pnpm's own pin first); the importers are in the last.
 */
const lockfileImporters = (lockText: string | undefined): string | undefined => {
  if (lockText === undefined) return undefined
  const docs = lockText.split(/^---\s*$/m).filter((d) => /^importers:/m.test(d))
  const main = docs.at(-1)
  if (main === undefined) return undefined
  try {
    const head = main.split(/^packages:/m)[0] ?? main
    const byImporter = record(record(parse(head)).importers)
    const out: string[] = []
    for (const name of Object.keys(byImporter).toSorted()) {
      const entry = record(byImporter[name])
      for (const field of depFields)
        for (const [dep, v] of Object.entries(record(entry[field])).toSorted(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ))
          out.push(`${name}\0${field}\0${dep}\0${text(record(v).version)}`)
    }
    return out.join("\n")
  } catch {
    return undefined
  }
}

/** `.` and every workspace package directory pnpm-workspace.yaml names, relative to `dir`. */
export const workspaceDirs = (dir: string): string[] => {
  let workspace: Record<string, unknown> = {}
  try {
    workspace = record(parse(readText(join(dir, "pnpm-workspace.yaml")) ?? ""))
  } catch {}
  return importers(dir, workspace)
}
