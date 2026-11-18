import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, type FileSystem, type Path } from "effect"
import { parseDocument } from "yaml"
import { type AddonManifest, addonIdsFor, type LoadedAddon } from "./addon.ts"
import { presentCardTransforms } from "./cards.ts"
import { BIN } from "./contract.ts"
import { unifiedDiff } from "./diff.ts"
import { INSTALL } from "./exec.ts"
import { type GenerateError, generate, isComputed, matches } from "./generate.ts"
import { workspaceDirs } from "./installed.ts"
import { parse as parseJsonc } from "jsonc-parser"
import { type EfforgeManifest, hash, renderManifest } from "./manifest.ts"
import { compareVersions, exactVersion } from "./semver.ts"
import type { StackConfig } from "./stack.ts"
import {
  runTransform,
  type TransformAnchorMissing,
  type TransformCall,
  transformTargets,
  type UnknownTransform,
} from "./transforms/index.ts"
import {
  effectOverrides,
  effectVersion,
  efforgeVersion,
  pinSetOf,
  pinSets,
  pnpmVersion,
  pnpmWildcardOverrides,
  versions,
} from "./versions.ts"

// `upgrade --check`: how a project differs from what this efforge generates for its stack. It
// reads, renders today's templates in memory and compares; it writes nothing. efforge.jsonc holds
// the hash of each file as efforge wrote it, not the content, so for a file both sides changed it
// can say that they did, and show today's template against the file, but not a three-way merge.

export type PinStatus = "same" | "behind" | "ahead" | "unmanaged"

export interface Pin {
  readonly name: string
  /** The version the project pins. */
  readonly project: string
  /** The version this efforge pins, or null when it doesn't manage the package. */
  readonly efforge: string | null
  readonly status: PinStatus
  /** Where the pin lives: `catalog` (pnpm-workspace.yaml), a package.json, or `packageManager`. */
  readonly where: string
  /** The set it moves with (`effect`, `drizzle`, ...), when it belongs to one. */
  readonly set?: string
}

export interface PinSet {
  readonly id: string
  readonly why: string
  /** The project's pins in this set. */
  readonly packages: ReadonlyArray<string>
  /** True when some members are at efforge's pin and others aren't: half of the set was bumped. */
  readonly split: boolean
}

export interface Guard {
  readonly id: "effect-overrides" | "package-manager"
  readonly ok: boolean
  readonly message: string
  /** effect-overrides: the override keys that are missing or not at the catalog's effect. */
  readonly missing?: ReadonlyArray<string>
}

/**
 * - `current`: unchanged since efforge wrote it, and today's template is the same
 * - `refresh`: unchanged since efforge wrote it, and the template has changed: safe to replace
 * - `review`: you changed it, and so did the template: needs a look
 * - `yours`: you changed it; the template didn't: nothing to do
 * - `deleted`: efforge wrote it, and it isn't there any more
 * - `dropped`: efforge no longer generates it for this stack
 * - `new`: efforge generates it today, and the project doesn't have it
 * - `differs`: efforge edits it in place (layers.ts, AGENTS.md, auth.ts), so it keeps no hash, and
 *   it differs from today's template: efforge can't tell whose change that is
 */
export type FileStatus =
  | "current"
  | "refresh"
  | "review"
  | "yours"
  | "deleted"
  | "dropped"
  | "new"
  | "differs"

export interface FileDrift {
  readonly path: string
  readonly status: FileStatus
  /** The file (or nothing) against today's template, when asked for (`--diff`). */
  readonly diff?: string
}

export interface Seam {
  readonly file: string
  /** What each missing piece is, one line each (`AGENTS.md section auth-secret`). */
  readonly missing: ReadonlyArray<string>
  /** The file against what efforge's transforms make of it today: the exact lines to add. */
  readonly diff: string
  /** Set when a transform couldn't find where to edit: what to add by hand. */
  readonly snippet?: string
}

/** A package.json script that differs from today's template: you changed it, or efforge did. */
export interface ScriptDrift {
  readonly file: string
  readonly name: string
  readonly yours: string
  readonly efforge: string
}

export interface UpgradeStep {
  readonly id: string
  readonly description: string
  readonly command?: string
  /** The directory to run `command` in (absolute). */
  readonly cwd?: string
  /** The file to edit, relative to the project. */
  readonly file?: string
  /** The exact lines the edit puts in `file`. */
  readonly lines?: string
  /** The files the step is about, relative to the project. */
  readonly files?: ReadonlyArray<string>
  /** `efforge add` also does this step the next time it adds an add-on. */
  readonly byAdd?: boolean
}

export interface UpgradeReport {
  readonly directory: string
  readonly stack: StackConfig
  readonly project: {
    readonly efforgeVersion: string
    readonly cli: string
    readonly status: "same" | "behind" | "ahead"
  }
  readonly drifted: boolean
  readonly pins: ReadonlyArray<Pin>
  readonly sets: ReadonlyArray<PinSet>
  readonly guards: ReadonlyArray<Guard>
  readonly files: ReadonlyArray<FileDrift>
  readonly seams: ReadonlyArray<Seam>
  readonly scripts: ReadonlyArray<ScriptDrift>
  readonly steps: ReadonlyArray<UpgradeStep>
  readonly warnings: ReadonlyArray<string>
  /** Every change in `steps` that keeps your edits, as a git patch (`--patch`); "" when none. */
  readonly patch: string
}

const read = (dir: string, rel: string): string | undefined => {
  try {
    return readFileSync(join(dir, rel), "utf8")
  } catch {
    return undefined
  }
}

const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const scalar = (v: unknown): string | undefined =>
  typeof v === "string" || typeof v === "number" ? String(v) : undefined

const status = (project: string, efforge: string | undefined): PinStatus => {
  if (efforge === undefined) return "unmanaged"
  const exact = exactVersion(project)
  if (exact === undefined) return project === efforge ? "same" : "unmanaged"
  const c = compareVersions(exact, efforge)
  return c === 0 ? "same" : c < 0 ? "behind" : "ahead"
}

/** The pnpm version a `packageManager` field pins, or undefined. */
export const pinnedPnpm = (packageManager: unknown): string | undefined =>
  typeof packageManager === "string"
    ? /^pnpm@(\d+\.\d+\.\d+(?:-[\w.-]+)?)/.exec(packageManager)?.[1]
    : undefined

/** The catalog and overrides of pnpm-workspace.yaml, read leniently. */
export const readWorkspace = (dir: string) => {
  const text = read(dir, "pnpm-workspace.yaml")
  let doc: Record<string, unknown> = {}
  try {
    doc = record(parseDocument(text ?? "").toJS())
  } catch {}
  const strings = (v: unknown) =>
    Object.fromEntries(
      Object.entries(record(v)).flatMap(([k, x]) => {
        const s = scalar(x)
        return s === undefined ? [] : [[k, s]]
      }),
    ) as Record<string, string>
  return { text, catalog: strings(doc.catalog), overrides: strings(doc.overrides) }
}

/** Override keys `effectOverrides` writes that `overrides` lacks or holds at another version. */
export const missingOverrides = (
  overrides: Readonly<Record<string, string>>,
  effect: string,
): string[] =>
  Object.keys(effectOverrides(effect)).filter((key) => {
    // an unscoped `effect` key (written by hand) covers the scoped one, as `add` accepts it
    const have = overrides[key] ?? (key.startsWith("effect@") ? overrides.effect : undefined)
    return have !== effect
  })

const pins = (dir: string, catalog: Readonly<Record<string, string>>): Pin[] => {
  const out: Pin[] = []
  const withSet = (p: Omit<Pin, "set">): Pin => {
    const set = pinSetOf(p.name)?.id
    return set === undefined ? p : { ...p, set }
  }
  for (const [name, project] of Object.entries(catalog))
    out.push(
      withSet({
        name,
        project,
        efforge: versions[name] ?? null,
        status: status(project, versions[name]),
        where: "catalog",
      }),
    )
  // a package built in its own Docker context (apps/browser) pins exact versions, not catalog:
  for (const d of workspaceDirs(dir)) {
    const file = d === "." ? "package.json" : `${d}/package.json`
    let pkg: Record<string, unknown> = {}
    try {
      pkg = record(JSON.parse(read(dir, file) ?? "{}"))
    } catch {}
    for (const field of ["dependencies", "devDependencies"])
      for (const [name, spec] of Object.entries(record(pkg[field]))) {
        const exact = typeof spec === "string" ? exactVersion(spec) : undefined
        if (exact === undefined || versions[name] === undefined) continue
        out.push(
          withSet({
            name,
            project: exact,
            efforge: versions[name],
            status: status(exact, versions[name]),
            where: file,
          }),
        )
      }
  }
  return out.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

const sets = (all: ReadonlyArray<Pin>): PinSet[] =>
  pinSets.flatMap((s) => {
    const members = all.filter((p) => p.set === s.id)
    if (!members.some((p) => p.status === "behind" || p.status === "ahead")) return []
    const at = new Set(members.map((p) => p.status === "same"))
    return [{ id: s.id, why: s.why, packages: members.map((p) => p.name), split: at.size > 1 }]
  })

/** Transforms of `manifest` that apply to `stack` and edit files the project has. */
const activeTransforms = (
  manifest: AddonManifest,
  stack: StackConfig,
  has: (file: string) => boolean,
): TransformCall[] =>
  [...manifest.transforms, ...presentCardTransforms(manifest, has)]
    .filter((t) => matches((t as { when?: never }).when, stack))
    // .dev.vars is local and gitignored: whether it has a value is `doctor`'s question
    .filter((t) => t.name !== "addDevVar")

/** What the missing piece a transform adds is, for people: `AGENTS.md section auth-secret`. */
const describe = (t: TransformCall): string => {
  const a = t.args
  switch (t.name) {
    case "appendAgentsSection":
      return `section ${a.id}`
    case "addLayer":
      return `layer ${a.layer}`
    case "addWranglerBinding":
      return `binding in ${a.key}`
    case "addAlchemyResource":
      return `resource ${a.name}`
    case "addWorkflowSecret":
      return `secret ${a.name}`
    case "addArrayItem":
      return `${a.item} in ${a.name}`
    case "addExport":
      return `export ${a.export} from ${a.from}`
    case "addImport":
      return `import ${a.import} from ${a.from}`
    case "addServerFnMiddleware":
      return `${a.middleware} on its server functions`
    case "addAuthPlugin":
      return `auth plugin ${a.call ?? a.property ?? a.import}`
    default:
      return t.name
  }
}

const seamsOf = (
  dir: string,
  stack: StackConfig,
  addons: ReadonlyArray<LoadedAddon>,
): Effect.Effect<{ seams: Seam[]; tree: ReadonlyMap<string, string> }, UnknownTransform> =>
  Effect.gen(function* () {
    const disk = new Map<string, string | undefined>()
    const at = (rel: string) => {
      if (!disk.has(rel)) disk.set(rel, read(dir, rel))
      return disk.get(rel)
    }
    const has = (rel: string) => at(rel) !== undefined
    let tree = new Map<string, string>()
    const missing = new Map<string, string[]>()
    const snippets = new Map<string, string[]>()
    for (const { manifest } of addons)
      for (const t of activeTransforms(manifest, stack, has)) {
        const targets = transformTargets(t)
        for (const f of targets) {
          const text = at(f)
          if (text !== undefined && !tree.has(f)) tree.set(f, text)
        }
        // a file the stack doesn't have at all (deleted, or an older layout) has nothing to compare
        if (!targets.every(has)) continue
        const result = yield* runTransform(tree, t).pipe(
          Effect.map((next) => ({ next, anchor: undefined })),
          Effect.catchTag("TransformAnchorMissing", (e: TransformAnchorMissing) =>
            Effect.succeed({ next: tree, anchor: e }),
          ),
        )
        if (result.anchor !== undefined) {
          const file = result.anchor.file
          snippets.set(file, [...(snippets.get(file) ?? []), result.anchor.snippet])
          missing.set(file, [...(missing.get(file) ?? []), `${describe(t)} (${manifest.id})`])
          continue
        }
        for (const [file, content] of result.next)
          if (tree.get(file) !== content)
            missing.set(file, [...(missing.get(file) ?? []), `${describe(t)} (${manifest.id})`])
        tree = new Map(result.next)
      }
    const seams = [...missing.keys()].toSorted().map((file): Seam => {
      const snippet = snippets.get(file)
      const seam: Seam = {
        file,
        missing: missing.get(file) ?? [],
        diff: gitDiff(file, at(file), tree.get(file) ?? ""),
      }
      return snippet === undefined ? seam : Object.assign(seam, { snippet: snippet.join("\n\n") })
    })
    return { seams, tree }
  })

/** Files no project keeps in git, and files only `doctor` asks about. */
const local = new Set([".dev.vars", ".env"])

const filesOf = (
  dir: string,
  manifest: EfforgeManifest,
  today: ReadonlyMap<string, string>,
  diffs: boolean,
): FileDrift[] => {
  const out: FileDrift[] = []
  const diff = (path: string, disk: string | undefined, template: string | undefined) =>
    diffs ? { diff: gitDiff(path, disk, template ?? "") } : {}
  for (const [path, recorded] of Object.entries(manifest.files)) {
    const disk = read(dir, path)
    const template = today.get(path)
    if (template === undefined) {
      out.push({ path, status: "dropped" })
      continue
    }
    if (disk === undefined) {
      out.push({ path, status: "deleted" })
      continue
    }
    const edited = hash(disk) !== recorded
    const moved = hash(template) !== recorded
    const s: FileStatus =
      disk === template
        ? "current"
        : !edited
          ? moved
            ? "refresh"
            : "current"
          : moved
            ? "review"
            : "yours"
    out.push({
      path,
      status: s,
      ...(s === "refresh" || s === "review" ? diff(path, disk, template) : {}),
    })
  }
  for (const [path, template] of today) {
    if (path in manifest.files || isComputed(path) || local.has(path)) continue
    const disk = read(dir, path)
    if (disk === undefined) out.push({ path, status: "new", ...diff(path, undefined, template) })
    else if (disk !== template) out.push({ path, status: "differs", ...diff(path, disk, template) })
  }
  return out.toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

const yamlKey = (k: string) => (/^[\w.-]+$/.test(k) ? k : `"${k}"`)

/** Compares the project in `dir` with what this efforge generates for its stack. Writes nothing. */
export const checkUpgrade = (
  dir: string,
  manifest: EfforgeManifest,
  loaded: ReadonlyMap<string, LoadedAddon>,
  opts: { readonly diff: boolean },
): Effect.Effect<
  UpgradeReport,
  GenerateError | TransformAnchorMissing | UnknownTransform,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const stack = manifest.stack
    const warnings: string[] = []
    const made = manifest.efforgeVersion
    const cmp = exactVersion(made) === undefined ? 0 : compareVersions(made, efforgeVersion)
    const project = {
      efforgeVersion: made,
      cli: efforgeVersion,
      status: cmp === 0 ? ("same" as const) : cmp < 0 ? ("behind" as const) : ("ahead" as const),
    }
    if (project.status === "ahead")
      warnings.push(
        `This project was made with efforge ${made}, newer than this CLI (${efforgeVersion}), so it is compared with older templates. Run ${BIN}@latest upgrade --check.`,
      )

    // versions
    const workspace = readWorkspace(dir)
    const allPins = pins(dir, workspace.catalog)
    let pkg: Record<string, unknown> = {}
    try {
      pkg = record(JSON.parse(read(dir, "package.json") ?? "{}"))
    } catch {}
    const pnpm = pinnedPnpm(pkg.packageManager)
    if (pnpm !== undefined)
      allPins.push({
        name: "pnpm",
        project: pnpm,
        efforge: pnpmVersion,
        status: status(pnpm, pnpmVersion),
        where: "packageManager",
      })
    const pinSetsFound = sets(allPins)

    // guards (ADR 0005)
    const effect = workspace.catalog.effect
    const effectBehind = effect !== undefined && status(effect, effectVersion) === "behind"
    const target = effect === undefined ? undefined : effectBehind ? effectVersion : effect
    const missingKeys = effect === undefined ? [] : missingOverrides(workspace.overrides, effect)
    const guards: Guard[] = []
    if (effect !== undefined)
      guards.push({
        id: "effect-overrides",
        ok: missingKeys.length === 0,
        message:
          missingKeys.length === 0
            ? `Every Effect package is held at effect ${effect}.`
            : `${missingKeys.length === Object.keys(effectOverrides(effect)).length ? "pnpm-workspace.yaml has no overrides holding Effect's packages" : `pnpm-workspace.yaml doesn't hold every Effect package (${missingKeys.join(", ")})`} at effect ${effect}. A library that asks for a newer one then installs it next to the older effect and the build breaks, as 0.2.0 projects did when Effect 4.1 shipped.`,
        ...(missingKeys.length === 0 ? {} : { missing: missingKeys }),
      })
    const pmOk = pnpm !== undefined && compareVersions(pnpm, pnpmWildcardOverrides) >= 0
    guards.push({
      id: "package-manager",
      ok: pmOk,
      message: pmOk
        ? `packageManager pins pnpm ${pnpm}, which honours the Effect overrides.`
        : pnpm === undefined
          ? `package.json has no packageManager pin, so whatever pnpm runs installs, and pnpm before ${pnpmWildcardOverrides} ignores the Effect overrides.`
          : `packageManager pins pnpm ${pnpm}, which accepts the Effect overrides and silently ignores them (they work from pnpm ${pnpmWildcardOverrides}).`,
    })

    // generated files, against today's templates for the project's own stack
    const ids = addonIdsFor(stack)
    const addons = ids.flatMap((id) => {
      const a = loaded.get(id)
      return a === undefined ? [] : [a]
    })
    const today = yield* generate(stack, loaded)
    const files = filesOf(dir, manifest, today, opts.diff)
    const { seams: transformSeams, tree: seamTree } = yield* seamsOf(dir, stack, addons)

    // every change efforge can make without touching your edits, file -> content after: the
    // steps below, and `--patch`
    const changes = new Map<string, string>()
    const behind = allPins.filter((p) => p.status === "behind" && p.where === "catalog")
    const fixGuard = target !== undefined && (missingKeys.length > 0 || effectBehind)

    // package.json files: what today's templates declare that the project's lack
    const packageSeams: Seam[] = []
    const scripts: ScriptDrift[] = []
    const newCatalog = new Map<string, string>()
    const todayCatalog = readCatalogText(today.get("pnpm-workspace.yaml"))
    for (const [path, text] of today) {
      if (path !== "package.json" && !path.endsWith("/package.json")) continue
      const before = read(dir, path)
      if (before === undefined) {
        // a workspace package the stack has today and the project doesn't
        changes.set(path, text)
        packageSeams.push({
          file: path,
          missing: ["the whole file"],
          diff: gitDiff(path, undefined, text),
        })
        continue
      }
      let disk: Record<string, unknown>
      try {
        disk = record(JSON.parse(before))
      } catch {
        continue
      }
      const want = record(JSON.parse(text))
      const missing: string[] = []
      const next: Record<string, unknown> = { ...disk }
      for (const field of ["dependencies", "devDependencies"] as const) {
        const have = record(disk[field])
        const add = Object.entries(record(want[field])).filter(([name]) => !(name in have))
        if (add.length === 0) continue
        const merged: Record<string, unknown> = { ...have }
        for (const [name, spec] of add) {
          merged[name] = spec
          missing.push(`${field === "devDependencies" ? "devDependency" : "dependency"} ${name}`)
          if (spec === "catalog:" && workspace.catalog[name] === undefined)
            newCatalog.set(name, todayCatalog[name] ?? versions[name] ?? "")
        }
        const keys = Object.keys(have)
        const sorted = keys.every((k, i) => i === 0 || (keys[i - 1] as string) <= k)
        next[field] = sorted
          ? Object.fromEntries(
              Object.entries(merged).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
            )
          : merged
      }
      const have = record(disk.scripts)
      for (const [name, cmd] of Object.entries(record(want.scripts)))
        if (name in have && have[name] !== cmd)
          scripts.push({ file: path, name, yours: String(have[name]), efforge: String(cmd) })
      const addScripts = Object.entries(record(want.scripts)).filter(([name]) => !(name in have))
      if (addScripts.length > 0) {
        next.scripts = { ...have, ...Object.fromEntries(addScripts) }
        missing.push(...addScripts.map(([name]) => `script ${name}`))
      }
      if (path === "package.json") {
        if (disk.engines === undefined && want.engines !== undefined) {
          next.engines = want.engines
          missing.push("engines")
        }
        if (!pmOk) next.packageManager = `pnpm@${pnpmVersion}`
      }
      // exact pins of a package built in its own Docker context
      for (const p of allPins)
        if (p.where === path && p.status === "behind")
          for (const field of ["dependencies", "devDependencies"] as const)
            if (record(next[field])[p.name] !== undefined)
              next[field] = { ...record(next[field]), [p.name]: p.efforge }
      const after = packageJson(next, before)
      if (after === before) continue
      changes.set(path, after)
      if (missing.length > 0)
        packageSeams.push({ file: path, missing, diff: gitDiff(path, before, after) })
    }

    // pnpm-workspace.yaml: the guard, the pins, and catalog entries for new dependencies
    if (workspace.text !== undefined && (fixGuard || behind.length > 0 || newCatalog.size > 0)) {
      const doc = parseDocument(workspace.text)
      for (const p of behind) doc.setIn(["catalog", p.name], p.efforge)
      for (const [name, version] of newCatalog) doc.setIn(["catalog", name], version)
      if (newCatalog.size > 0) {
        const catalog = record(
          (doc.getIn(["catalog"]) as { toJSON(): unknown } | undefined)?.toJSON(),
        )
        doc.setIn(
          ["catalog"],
          Object.fromEntries(
            Object.entries(catalog).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
          ),
        )
      }
      if (fixGuard && target !== undefined)
        for (const [key, version] of Object.entries(effectOverrides(target)))
          doc.setIn(
            [
              "overrides",
              key.startsWith("effect@") && doc.hasIn(["overrides", "effect"]) ? "effect" : key,
            ],
            version,
          )
      const after = doc.toString()
      if (after !== workspace.text) changes.set("pnpm-workspace.yaml", after)
    }

    const refresh = files.filter((f) => f.status === "refresh")
    const added = files.filter((f) => f.status === "new")
    for (const f of [...refresh, ...added]) changes.set(f.path, today.get(f.path) as string)
    for (const s of transformSeams)
      if (s.snippet === undefined) changes.set(s.file, seamTree.get(s.file) as string)
    const seams = [...packageSeams, ...transformSeams].toSorted((a, b) =>
      a.file < b.file ? -1 : 1,
    )

    // efforge.jsonc: what it now holds is efforge's, so a later `add` may replace it
    const todayHashes = record(
      (() => {
        try {
          return record(parseJsonc(today.get("efforge.jsonc") ?? "")).files
        } catch {
          return {}
        }
      })(),
    )
    const rehashed = [...refresh, ...added].filter((f) => typeof todayHashes[f.path] === "string")
    const manifestText = read(dir, "efforge.jsonc")
    if (rehashed.length > 0 && manifestText !== undefined) {
      const filesMap = { ...manifest.files }
      for (const f of rehashed) filesMap[f.path] = todayHashes[f.path] as string
      const after = renderManifest({
        ...manifest,
        files: Object.fromEntries(
          Object.entries(filesMap).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        ),
      })
      if (after !== manifestText) changes.set("efforge.jsonc", after)
    }

    // what to do, in order
    const steps: UpgradeStep[] = []
    if (project.status === "ahead")
      steps.push({
        id: "newer-cli",
        description: `Compare with the efforge that made this project, or a newer one.`,
        command: `${BIN}@latest upgrade --check`,
        cwd: dir,
      })
    if (changes.size > 0)
      steps.push({
        id: "patch",
        description: `The next steps at once, leaving files you edited alone: a patch of ${changes.size === 1 ? "1 file" : `${changes.size} files`} (git apply refuses it if one changed since). Or do them by hand.`,
        command: `${BIN} upgrade --check --patch | git apply`,
        cwd: dir,
      })
    if (fixGuard && target !== undefined)
      steps.push({
        id: "effect-overrides",
        description: `Hold every Effect package at effect ${target}: in pnpm-workspace.yaml, under overrides:, set these lines (keep \`vite: "catalog:"\`).`,
        file: "pnpm-workspace.yaml",
        lines: `overrides:\n${Object.entries(effectOverrides(target))
          .map(([k, v]) => `  ${yamlKey(k)}: ${v}`)
          .join("\n")}`,
        ...(effectBehind ? {} : { byAdd: true }),
      })
    if (!pmOk)
      steps.push({
        id: "package-manager",
        description: `Pin a pnpm that honours the overrides: in package.json, set packageManager. pnpm switches to it on its own.`,
        file: "package.json",
        lines: `"packageManager": "pnpm@${pnpmVersion}"`,
        byAdd: true,
      })
    if (behind.length > 0) {
      const grouped = new Map<string, string[]>()
      for (const p of behind) {
        const key = p.set ?? ""
        grouped.set(key, [...(grouped.get(key) ?? []), `  ${yamlKey(p.name)}: ${p.efforge}`])
      }
      const lines = [...pinSets.map((s) => s.id), ""]
        .filter((k) => grouped.has(k))
        .flatMap((k) =>
          [`  # ${k === "" ? "on their own" : `${k} (move together)`}`].concat(
            grouped.get(k) ?? [],
          ),
        )
      steps.push({
        id: "pins",
        description: `Move the catalog to the versions this efforge pins and tests together: in pnpm-workspace.yaml, under catalog:, set these lines.${pinSetsFound.length > 0 ? ` Each group moves as one (${pinSetsFound.map((s) => s.id).join(", ")}).` : ""}`,
        file: "pnpm-workspace.yaml",
        lines: `catalog:\n${lines.join("\n")}`,
      })
    }
    for (const s of seams)
      steps.push({
        id: "seam",
        description: `${s.file} lacks what efforge adds there today: ${s.missing.join("; ")}.${s.snippet === undefined ? " Add the + lines." : " efforge couldn't find where; add it by hand."}${newCatalog.size > 0 && s.file.endsWith("package.json") && s.missing.some((m) => m.includes("ependency")) ? ` The catalog in pnpm-workspace.yaml gets ${[...newCatalog].map(([n, v]) => `${n}: ${v}`).join(", ")}.` : ""}`,
        file: s.file,
        lines: s.snippet ?? s.diff,
      })
    if (refresh.length > 0)
      steps.push({
        id: "refresh",
        description: `Replace ${refresh.length === 1 ? "1 file" : `${refresh.length} files`} you haven't changed with efforge's current version; --diff shows each change.`,
        files: refresh.map((f) => f.path),
      })
    if (added.length > 0)
      steps.push({
        id: "new",
        description: `Add ${added.length === 1 ? "1 file" : `${added.length} files`} efforge generates today for this stack; the refreshed files may import them.`,
        files: added.map((f) => f.path),
      })
    if (rehashed.length > 0)
      steps.push({
        id: "manifest",
        description: `Record their hashes in efforge.jsonc, so a later efforge add knows they are efforge's (by hand, skip it: add then treats them as yours).`,
        file: "efforge.jsonc",
      })
    for (const file of new Set(scripts.map((x) => x.file)))
      steps.push({
        id: "scripts",
        description: `${file}: these scripts differ from efforge's today, and it can't tell whose change that is. If they are still efforge's, set them; the refreshed files may need them.`,
        file,
        lines: scripts
          .filter((x) => x.file === file)
          .map((x) => `"${x.name}": ${JSON.stringify(x.efforge)}`)
          .join(",\n"),
      })
    if (changes.size > 0)
      steps.push({
        id: "install",
        description: "Install what changed.",
        command: INSTALL,
        cwd: dir,
      })
    const review = files.filter((f) => f.status === "review" || f.status === "differs")
    if (review.length > 0)
      steps.push({
        id: "review",
        description: `Look at ${review.length === 1 ? "1 file" : `${review.length} files`} that differ from efforge's template where it can't tell whose change it is (efforge keeps a hash of what it wrote, not the content, and none for files it edits in place). Take what you want from the diff; to take efforge's version of a file whole, pipe it to git apply --include=<file>.`,
        command: `${BIN} upgrade --check --diff`,
        cwd: dir,
        files: review.map((f) => f.path),
      }) // drifted exactly when the patch has something in it: a file you edited, deleted or keep
    // differently from the template never counts, so there is always a way back to exit code 0
    const drifted = changes.size > 0 || guards.some((g) => !g.ok)
    // name the steps the patch makes, now that they are numbered
    const patched = new Set([
      "effect-overrides",
      "package-manager",
      "pins",
      "seam",
      "refresh",
      "new",
      "manifest",
    ])
    const at = steps.findIndex((x) => x.id === "patch")
    const last = steps.findLastIndex((x) => patched.has(x.id))
    if (at >= 0 && last > at)
      steps[at] = {
        ...(steps[at] as UpgradeStep),
        description: (steps[at] as UpgradeStep).description
          .replace(
            "The next steps",
            last === at + 1 ? `Step ${at + 2}` : `Steps ${at + 2}–${last + 1}`,
          )
          .replace(
            "Or do them by hand.",
            last === at + 1 ? "Or do it by hand." : "Or do them by hand.",
          ),
      }
    if (steps.length > 0)
      steps.push({
        id: "gate",
        description: "Check the project still passes its gate.",
        command: "pnpm typecheck && pnpm check && pnpm test && pnpm build",
        cwd: dir,
      })
    return {
      directory: dir,
      stack,
      project,
      drifted,
      pins: allPins,
      sets: pinSetsFound,
      guards,
      files,
      seams,
      scripts,
      steps,
      warnings,
      patch: renderPatch(dir, changes),
    }
  })

/** `before` -> `after` as a git diff of one file, for `git apply`; "" when equal. */
export const gitDiff = (file: string, before: string | undefined, after: string): string => {
  const body = unifiedDiff(file, before ?? "", after)
    .split("\n")
    .slice(2)
    .join("\n")
  if (body.trim() === "") return ""
  const head =
    before === undefined
      ? [`diff --git a/${file} b/${file}`, "new file mode 100644", "--- /dev/null", `+++ b/${file}`]
      : [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`]
  return `${head.join("\n")}\n${body}`
}

/** A git patch of `changes` (file -> content after), for `git apply`. */
const renderPatch = (dir: string, changes: ReadonlyMap<string, string>): string =>
  [...changes.keys()]
    .toSorted()
    .map((file) => gitDiff(file, read(dir, file), changes.get(file) as string))
    .join("")

/** package.json text for `pkg`, in the file's indent; `engines` and `packageManager` last. */
const packageJson = (pkg: Record<string, unknown>, before: string): string => {
  const { engines, packageManager, ...rest } = pkg
  const ordered = {
    ...rest,
    ...(engines === undefined ? {} : { engines }),
    ...(packageManager === undefined ? {} : { packageManager }),
  }
  const indent = /^([ \t]+)"/m.exec(before)?.[1] ?? "  "
  const next = `${JSON.stringify(ordered, null, indent)}${before.endsWith("\n") ? "\n" : ""}`
  // unchanged data keeps the file as it is
  return JSON.stringify(JSON.parse(before)) === JSON.stringify(pkg) ? before : next
}

const readCatalogText = (text: string | undefined): Record<string, string> => {
  try {
    const catalog = record(record(parseDocument(text ?? "").toJS()).catalog)
    return Object.fromEntries(Object.entries(catalog).map(([k, v]) => [k, String(v)]))
  } catch {
    return {}
  }
}
