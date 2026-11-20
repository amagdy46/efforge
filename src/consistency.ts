import { posix } from "node:path"
import { closure, normalize, sourceInfo, type SourceInfo } from "./source.ts"
import { addRegionText } from "./transforms/addRegion.ts"
import { setDeclarationText } from "./transforms/setDeclaration.ts"

// Keeps an upgrade a consistent set (docs/decisions/0011-upgrade-applies-what-efforge-can-prove.md).
// Every import that the plan touches must still hold afterwards: a file efforge writes gets what
// it imports (the file, its names, its `?region=` blocks, the declarations those names use), and
// a file efforge doesn't write keeps what it imported. Where a file efforge edits in place lacks
// something a new file needs, efforge adds it with the same transforms `add` uses; where it can't
// do that safely, the files that need it are held back, with the reason and the lines.

export interface Hold {
  readonly path: string
  /** One sentence: why efforge keeps the file as it is. */
  readonly reason: string
  /** The exact lines that would let efforge apply it, when there are some. */
  readonly lines?: string
}

/** A change efforge makes to a file it edits in place, so that what it writes builds. */
export interface SeamChange {
  readonly file: string
  readonly what: string
}

/** An import that is broken in the project as it is now. */
export interface Broken {
  readonly from: string
  readonly to: string
  readonly what: string
}

export interface ConsistencyInput {
  /** The project's name, for records. */
  readonly name: string
  /** A file on disk, or undefined. */
  readonly disk: (path: string) => string | undefined
  /** Every .ts/.tsx file on disk that the build or the tests can see. */
  readonly sources: ReadonlyArray<string>
  /** What efforge generates today. */
  readonly today: ReadonlyMap<string, string>
  /** The plan: file -> content after. Edited in place. */
  readonly changes: Map<string, string>
  /** Files the plan removes. Edited in place. */
  readonly removes: Set<string>
  /** Files efforge edits in place (no hash): where it may add what a new file needs. */
  readonly inPlace: (path: string) => boolean
  /** Files efforge generated that the owner removed: never put back. */
  readonly deleted: (path: string) => boolean
  /** True when `text` holds only what efforge wrote for `path` (today, or a release since). */
  readonly efforgeOwn: (path: string, text: string) => boolean
  /** package.json path -> dependency -> true when the owner removed it (a release declared it). */
  readonly removedDependency: (pkg: string, dep: string) => boolean
  /** Adds `dep` to `pkg` in the plan (and the catalog); false when it can't. */
  readonly addDependency: (pkg: string, dep: string) => boolean
  /**
   * The type `file` exports as `name` before (`after` false) and after the plan, as the project's
   * TypeScript sees it; undefined when it can't tell (then any change of the text counts).
   */
  readonly typeOf?: (file: string, name: string, after: boolean) => string | undefined
}

export interface ConsistencyResult {
  readonly holds: ReadonlyArray<Hold>
  readonly seams: ReadonlyArray<SeamChange>
  /** Imports broken before any change, from files that are efforge's as written today. */
  readonly broken: ReadonlyArray<Broken>
}

const SOURCE = /\.(?:ts|tsx|mts|cts)$/
const EXTS = [".ts", ".tsx", "/index.ts", "/index.tsx"]

/** Node built-ins and virtual modules a bundler provides: nothing to declare. */
const builtin = (name: string) =>
  name.startsWith("node:") ||
  name.startsWith("virtual:") ||
  name.startsWith("cloudflare:") ||
  ["fs", "path", "url", "os", "crypto", "child_process", "util", "stream", "events"].includes(name)

const packageName = (spec: string) =>
  spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : (spec.split("/")[0] as string)

/** The directory of the workspace package `file` belongs to (`apps/web`, `packages/core`, `.`). */
const packageDir = (file: string, exists: (p: string) => boolean): string => {
  let dir = posix.dirname(file)
  while (dir !== "." && dir !== "") {
    if (exists(`${dir}/package.json`)) return dir
    dir = posix.dirname(dir)
  }
  return "."
}

const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

export const checkConsistency = (input: ConsistencyInput): ConsistencyResult => {
  const { changes, removes, today, disk } = input
  const final = (p: string): string | undefined =>
    changes.get(p) ?? (removes.has(p) ? undefined : disk(p))
  const exists = (p: string) => final(p) !== undefined
  const isToday = (p: string) => {
    const f = final(p)
    return f !== undefined && f === today.get(p)
  }
  /** Planned files whose content is efforge's today (refreshed, new): they expect today's tree. */
  const todayPlanned = (p: string) => changes.has(p) && changes.get(p) === today.get(p)

  const holds = new Map<string, Hold>()
  const seams: SeamChange[] = []
  const original = new Map<string, string | undefined>() // what a held file goes back to

  const hold = (path: string, reason: string, lines?: string) => {
    if (holds.has(path)) return
    holds.set(path, lines === undefined ? { path, reason } : { path, reason, lines })
    changes.delete(path)
    removes.delete(path)
  }

  const workspace = new Map<string, string>() // @repo/x -> dir
  const workspaceOf = () => {
    workspace.clear()
    const files = new Set([...input.sources, ...changes.keys(), ...today.keys()])
    for (const f of files)
      if (f.endsWith("/package.json")) {
        const text = final(f)
        if (text === undefined) continue
        try {
          const n = record(JSON.parse(text)).name
          if (typeof n === "string") workspace.set(n, posix.dirname(f))
        } catch {}
      }
  }

  const resolveFile = (base: string): string | undefined => {
    const clean = base.replace(/\.js$/, ".ts")
    // on disk too: an import of a file the plan removes still names that file
    const there = (p: string) => exists(p) || disk(p) !== undefined
    if (SOURCE.test(clean) && there(clean)) return clean
    for (const e of EXTS) if (there(`${clean}${e}`)) return `${clean}${e}`
    // a file that doesn't exist yet: name what today's tree would resolve it to
    if (SOURCE.test(clean) && today.has(clean)) return clean
    for (const e of EXTS) if (today.has(`${clean}${e}`)) return `${clean}${e}`
    return SOURCE.test(clean) ? clean : undefined
  }

  type Target =
    | { kind: "file"; path: string }
    | { kind: "package"; name: string }
    | { kind: "other" }
  const resolve = (from: string, spec: string): Target => {
    if (spec.startsWith(".")) {
      const p = resolveFile(posix.normalize(posix.join(posix.dirname(from), spec)))
      return p === undefined ? { kind: "other" } : { kind: "file", path: p }
    }
    if (spec.startsWith("@/")) {
      const app = /^(apps\/[^/]+)\//.exec(from)?.[1]
      if (app === undefined) return { kind: "other" }
      const p = resolveFile(`${app}/src/${spec.slice(2)}`)
      return p === undefined ? { kind: "other" } : { kind: "file", path: p }
    }
    const name = packageName(spec)
    const dir = workspace.get(name)
    if (dir !== undefined) {
      const sub = spec.slice(name.length).replace(/^\//, "")
      const p = resolveFile(sub === "" ? `${dir}/src/index` : `${dir}/src/${sub}`)
      return p === undefined ? { kind: "other" } : { kind: "file", path: p }
    }
    return { kind: "package", name }
  }

  const info = (p: string, text: string | undefined): SourceInfo | undefined => {
    if (text === undefined || !SOURCE.test(p)) return undefined
    try {
      return sourceInfo(p, text)
    } catch {
      return undefined
    }
  }

  /** Every name `p` exports as `text`, following `export * from` through the final tree. */
  const exportsOf = (
    p: string,
    text: string | undefined,
    seen = new Set<string>(),
  ): Set<string> => {
    const out = new Set<string>()
    const i = info(p, text)
    if (i === undefined || seen.has(p)) return out
    seen.add(p)
    for (const n of i.exports) out.add(n)
    for (const spec of i.reexports) {
      const t = resolve(p, spec)
      if (t.kind === "file") for (const n of exportsOf(t.path, final(t.path), seen)) out.add(n)
    }
    return out
  }

  const declared = (from: string, name: string): boolean => {
    const pkg = packageDir(from, exists)
    const file = pkg === "." ? "package.json" : `${pkg}/package.json`
    const check = (f: string) => {
      try {
        const j = record(JSON.parse(final(f) ?? "{}"))
        return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].some(
          (k) => name in record(j[k]),
        )
      } catch {
        return false
      }
    }
    return check(file) || (file !== "package.json" && check("package.json"))
  }

  /**
   * What `to` (as `text`) lacks of what `from` needs, as efforge writes `to` today: the file, its
   * names, a region, and the declarations those names use. Empty when nothing.
   */
  const lacking = (
    to: string,
    text: string | undefined,
    names: ReadonlyArray<string>,
    region: string | undefined,
    declarations = true,
  ): string[] => {
    if (text === undefined) return ["the file"]
    const out: string[] = []
    const mine = info(to, text)
    if (region !== undefined && !(mine?.regions.has(region) ?? false))
      out.push(`its \`// #region ${region}\` block`)
    const want = info(to, today.get(to))
    const have = exportsOf(to, text)
    for (const n of names)
      if (!have.has(n)) out.push(`\`${n === "default" ? "a default export" : n}\``)
    if (declarations && want !== undefined && mine !== undefined) {
      for (const d of closure(
        want,
        names.filter((n) => have.has(n)),
      )) {
        const m = mine.declarations.get(d.name)
        if (m === undefined) continue // re-exported or declared elsewhere: names checked above
        const same = d.kind === "type" ? m.text === d.text : m.signature === d.signature
        if (!same) out.push(`\`${d.name}\` as efforge declares it today`)
      }
    }
    return out
  }

  /** Makes `to` (a file efforge edits in place) give what `from` needs; false when it can't. */
  const seam = (
    to: string,
    names: ReadonlyArray<string>,
    region: string | undefined,
  ): { ok: true } | { ok: false; lines: string } => {
    const t = today.get(to)
    let text = final(to)
    if (t === undefined || text === undefined) return { ok: false, lines: "" }
    const want = info(to, t)
    if (want === undefined) return { ok: false, lines: "" }
    const did: string[] = []
    const fail = (lines: string) => ({ ok: false as const, lines })
    if (region !== undefined && !(info(to, text)?.regions.has(region) ?? false)) {
      const inside = [...want.declarations.values()].filter((d) => {
        const before = t.slice(0, d.start)
        const open = before.lastIndexOf(`// #region ${region}`)
        return open >= 0 && before.indexOf("// #endregion", open) < 0
      })
      const next = addRegionText(
        to,
        text,
        region,
        inside.map((d) => d.name),
      )
      if (next === undefined)
        return fail(
          `// #region ${region}\n(${inside.map((d) => d.name).join(", ")})\n// #endregion`,
        )
      text = next
      did.push(`its \`// #region ${region}\` block`)
    }
    // names today's file imports: a declaration that uses one the file lacks can't be added alone
    const importedToday = new Map(want.imports.flatMap((e) => e.names.map((n) => [n, e.spec])))
    for (const d of closure(want, names)) {
      const statement = t.slice(d.start, d.end)
      const now = info(to, text)
      const has = new Set(now?.imports.flatMap((e) => e.names) ?? [])
      const unimported = [...d.refs].filter(
        (r) => importedToday.has(r) && !has.has(r) && !(now?.declarations.has(r) ?? false),
      )
      if (unimported.length > 0)
        return fail(
          `${unimported.map((r) => `import { ${r} } from "${importedToday.get(r)}"`).join("\n")}\n\n${statement}`,
        )
      const mine = now?.declarations.get(d.name)
      if (mine !== undefined) {
        const same = d.kind === "type" ? mine.text === d.text : mine.signature === d.signature
        if (same) continue
        // only efforge's own older declaration is replaced; one the owner wrote stays
        if (!input.efforgeOwn(to, text.slice(mine.start, mine.end))) return fail(statement)
      }
      text = setDeclarationText(to, text, d.name, statement)
      did.push(`\`${d.name}\``)
    }
    const after = exportsOf(to, text)
    const missingNames = names.filter((n) => !after.has(n))
    if (missingNames.length > 0)
      return fail(
        missingNames
          .map((n) =>
            t.slice(want.declarations.get(n)?.start ?? 0, want.declarations.get(n)?.end ?? 0),
          )
          .join("\n\n"),
      )
    if (text !== final(to)) {
      if (!original.has(to)) original.set(to, disk(to))
      changes.set(to, text)
      seams.push({ file: to, what: did.join(", ") })
    }
    return { ok: true }
  }

  const describe = (path: string) => path

  // 1. what is broken before any change: imports of efforge's own current files
  const broken: Broken[] = []
  {
    const saved = new Map(changes)
    const savedRemoves = new Set(removes)
    changes.clear()
    removes.clear()
    workspaceOf()
    for (const from of input.sources) {
      const text = disk(from)
      if (text === undefined || text !== today.get(from)) continue
      for (const edge of info(from, text)?.imports ?? []) {
        const t = resolve(from, edge.spec)
        if (t.kind !== "file") continue
        if (!today.has(t.path)) continue
        // only what fails for certain: a file, a name, a region (a declaration that differs may
        // still fit)
        const miss = lacking(t.path, disk(t.path), edge.all ? [] : edge.names, edge.region, false)
        if (miss.length > 0) broken.push({ from, to: t.path, what: miss.join(", ") })
      }
    }
    for (const [k, v] of saved) changes.set(k, v)
    for (const r of savedRemoves) removes.add(r)
  }

  // 2. the plan, to a fixed point
  for (let round = 0; round < 50; round++) {
    let moved = false
    workspaceOf()
    const files = new Set([...input.sources, ...changes.keys()])
    for (const from of files) {
      // a held file stays as it is on disk, so, like a file efforge doesn't write, it keeps what
      // it imports: a change to that holds back too
      const held = holds.has(from)
      if (held && !exists(from)) continue
      const text = held ? disk(from) : final(from)
      const fi = info(from, text)
      if (fi === undefined) continue
      const fromPlanned = !held && todayPlanned(from)
      // efforge's own file as it is today, written now or already there, expects today's tree
      const expectsToday =
        !held && (fromPlanned || (text !== undefined && text === today.get(from)))
      for (const edge of fi.imports) {
        const t = resolve(from, edge.spec)
        if (t.kind === "package") {
          if (!fromPlanned || builtin(t.name) || declared(from, t.name)) continue
          const pkg = packageDir(from, exists)
          const file = pkg === "." ? "package.json" : `${pkg}/package.json`
          if (!input.removedDependency(file, t.name) && input.addDependency(file, t.name)) {
            moved = true
            continue
          }
          hold(
            from,
            `it imports ${t.name}, which ${file} doesn't declare${input.removedDependency(file, t.name) ? " (it was removed)" : ""}`,
            `"${t.name}": "catalog:"`,
          )
          moved = true
          break
        }
        if (t.kind !== "file") continue
        const to = t.path
        const names = edge.all ? [] : edge.names
        if (expectsToday) {
          // a file efforge writes expects what today's tree has
          if (isToday(to)) continue
          if (
            !exists(to) &&
            today.has(to) &&
            !holds.has(to) &&
            !input.deleted(to) &&
            (fromPlanned || !removes.has(to))
          ) {
            changes.set(to, today.get(to) as string)
            removes.delete(to)
            moved = true
            continue
          }
          const miss = lacking(to, final(to), names, edge.region)
          if (miss.length === 0) continue
          if (input.inPlace(to) && !holds.has(to)) {
            const r = seam(to, names, edge.region)
            if (r.ok) {
              moved = true
              continue
            }
            if (!fromPlanned) continue // already broken: `broken` says so
            hold(
              from,
              `it needs ${miss.join(", ")} in ${describe(to)}, which you changed, so efforge can't add ${miss.length === 1 ? "it" : "them"} for you`,
              r.lines === "" ? undefined : r.lines,
            )
          } else if (!fromPlanned) continue
          else
            hold(
              from,
              input.deleted(to) && !exists(to)
                ? `it needs ${to}, which you removed`
                : holds.has(to)
                  ? `it needs efforge's new ${to}, which is held back too`
                  : `it needs ${miss.join(", ")} in ${to}, which efforge isn't changing (you edited it)`,
            )
          moved = true
          break
        }
        // a file efforge doesn't write keeps what it imported
        const before = disk(to)
        const after = final(to)
        if (before === undefined || after === before) continue
        if (text === today.get(from) && todayPlanned(to)) continue
        const was = info(to, before)
        const now = info(to, after)
        const broke: string[] = []
        if (
          edge.region !== undefined &&
          (was?.regions.has(edge.region) ?? false) &&
          !(now?.regions.has(edge.region) ?? false)
        )
          broke.push(`its \`// #region ${edge.region}\` block`)
        if (was !== undefined) {
          const had = exportsOf(to, before)
          const has = after === undefined ? new Set<string>() : exportsOf(to, after)
          for (const n of names) {
            if (had.has(n) && !has.has(n)) {
              broke.push(`\`${n}\``)
              continue
            }
            // anything it uses that efforge's version changes: for a value, its type as the
            // project's TypeScript sees it (a new body is fine); else the declarations themselves
            const own = was.declarations.get(n)
            const changed = closure(was, [n]).filter((d) => {
              const nd = now?.declarations.get(d.name)
              return nd !== undefined && nd.text !== d.text
            })
            if (changed.length === 0) continue
            if (own?.kind === "value" && input.typeOf !== undefined) {
              const a = input.typeOf(to, n, false)
              const b = a === undefined ? undefined : input.typeOf(to, n, true)
              if (a !== undefined && b !== undefined) {
                if (a !== b) broke.push(`\`${n}\` with the type it has now`)
                continue
              }
            }
            broke.push(`\`${n}\` as it is now`)
          }
        } else if (after === undefined) broke.push("the file")
        if (broke.length === 0) continue
        const label = removes.has(to)
          ? "efforge no longer generates it"
          : "efforge's new version changes it"
        hold(to, `${from} imports ${[...new Set(broke)].join(", ")} from it, and ${label}`)
        moved = true
        break
      }
    }
    if (!moved) break
  }

  // a seam change whose only reason was a file now held back goes back too
  for (const [file] of original)
    if (!holds.has(file) && changes.has(file)) {
      const needed = [...changes.keys()].some(
        (p) =>
          todayPlanned(p) &&
          (info(p, changes.get(p))?.imports ?? []).some((e) => {
            const t = resolve(p, e.spec)
            return t.kind === "file" && t.path === file
          }),
      )
      if (!needed) {
        changes.delete(file)
        const i = seams.findIndex((s) => s.file === file)
        if (i >= 0) seams.splice(i, 1)
      }
    }

  return { holds: [...holds.values()], seams, broken }
}

/** Every .ts/.tsx file under `roots` a build or test sees, given a directory lister. */
export const sourceFiles = (
  list: (dir: string) => ReadonlyArray<{ name: string; dir: boolean }>,
): string[] => {
  const out: string[] = []
  const walk = (rel: string) => {
    for (const e of list(rel)) {
      if (
        e.name === "node_modules" ||
        e.name.startsWith(".") ||
        ["dist", "build", ".output"].includes(e.name)
      )
        continue
      const child = rel === "" ? e.name : `${rel}/${e.name}`
      if (e.dir) walk(child)
      else if (SOURCE.test(e.name) && !e.name.endsWith(".d.ts") && e.name !== "routeTree.gen.ts")
        out.push(child)
    }
  }
  walk("")
  return out
}

export { normalize }
