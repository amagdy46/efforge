import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, type FileSystem, type Path } from "effect"
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser"
import { parseDocument } from "yaml"
import { type AddonManifest, addonIdsFor, type LoadedAddon } from "./addon.ts"
import { presentCardTransforms } from "./cards.ts"
import { checkConsistency, sourceFiles } from "./consistency.ts"
import { BIN } from "./contract.ts"
import { unifiedDiff } from "./diff.ts"
import { type GenerateError, generate, isComputed, matches } from "./generate.ts"
import {
  efforgeDeclared,
  efforgeGenerated,
  efforgePinned,
  efforgeScript,
  enginesNew,
  recordFor,
  releasesSince,
} from "./history.ts"
import { installOwed, workspaceDirs } from "./installed.ts"
import { type EfforgeManifest, hash } from "./manifest.ts"
import { compareWithRecord, onlyEfforgeOwn, shingles } from "./record.ts"
import { compareVersions, exactVersion } from "./semver.ts"
import type { StackConfig } from "./stack.ts"
import { sameStructure } from "./structure.ts"
import { typeProbe } from "./types.ts"
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
import { upgradeNote } from "./upgrade-notes.ts"

// `upgrade`: how a project differs from what this efforge generates for its stack, and the set of
// changes efforge can make without touching the owner's work (docs/decisions/0010). It renders
// today's templates in memory and compares, file by file, pin by pin, using two records: the hash
// of each file efforge wrote (efforge.jsonc) and what each release generated (src/history.ts).
// Where neither says a thing is efforge's, it is the owner's, and efforge leaves it alone.
// `--check` stops at the report; `upgrade` writes `changes` and `removes`.

/**
 * - `same`: efforge pins this version today
 * - `behind`: an efforge release pinned this version and this one pins another: efforge's to move
 * - `yours`: no efforge release pinned this version: your choice, never moved
 * - `unmanaged`: efforge doesn't pin the package
 */
export type PinStatus = "same" | "behind" | "yours" | "unmanaged"

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
  /** Behind, but kept: another pin of its set is yours, and moving this one would split it. */
  readonly held?: boolean
}

export interface PinSet {
  readonly id: string
  readonly why: string
  /** The project's pins in this set. */
  readonly packages: ReadonlyArray<string>
  /** True when no efforge release pinned the set as the project will have it: half of it moved. */
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
 * - `current`: as efforge writes it today
 * - `refresh`: efforge's own older output (by its hash, or for a file efforge edits in place, by
 *   the record of what releases wrote), and today's template differs: `upgrade` replaces it
 * - `review`: you changed it, and so did the template: `upgrade` leaves it
 * - `yours`: you changed it; it still has everything today's template has
 * - `deleted`: efforge wrote it, and you removed it
 * - `dropped`: efforge no longer generates it (`upgrade` removes it when it is efforge's, unedited)
 * - `new`: efforge generates it today, and the project doesn't have it
 */
export type FileStatus = "current" | "refresh" | "review" | "yours" | "deleted" | "dropped" | "new"

export interface FileDrift {
  readonly path: string
  readonly status: FileStatus
  /** A file efforge edits in place (layers.ts, AGENTS.md): judged by the release record. */
  readonly inPlace?: boolean
  /** Set when efforge would apply this file and holds it back to keep the project consistent. */
  readonly held?: { readonly reason: string; readonly lines?: string }
  /** What efforge's change to it is for, when it has one. */
  readonly why?: string
  /** The file (or nothing) against today's template, when asked for (`--diff`). */
  readonly diff?: string
}

export interface Seam {
  readonly file: string
  /** What each missing piece is, one line each (`engines`, `\`// #region card\` block`). */
  readonly missing: ReadonlyArray<string>
  /** The file against what `upgrade` makes of it: the exact lines. */
  readonly diff: string
}

export interface ScriptDrift {
  readonly file: string
  readonly name: string
  readonly yours: string
  readonly efforge: string
  /** `behind`: an efforge release wrote yours, so `upgrade` moves it; `yours`: yours, kept. */
  readonly status: "behind" | "yours"
}

/** Something that breaks the project as it is now. */
export interface NeedsAction {
  readonly id: "effect-overrides" | "package-manager" | "split-set" | "missing-seam" | "install"
  readonly message: string
  /** A command after which this is fixed, or null (then `message` and `lines` say what to change). */
  readonly fix: string | null
  readonly lines?: string
}

/** A file `upgrade` won't change for you, and why. */
export interface Kept {
  readonly path: string
  /** `review`: you changed it and so did the template; `held`: efforge's, held back. */
  readonly status: "review" | "held"
  readonly reason: string
  readonly lines?: string
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
  /** The `upgrade` step: what it does, by kind. */
  readonly covers?: ReadonlyArray<string>
}

export interface UpgradeReport {
  readonly directory: string
  readonly stack: StackConfig
  readonly project: {
    readonly efforgeVersion: string
    readonly cli: string
    readonly status: "same" | "behind" | "ahead"
  }
  /** `needs-action` when something breaks the project now, else `behind` when `upgrade` has something to apply. */
  readonly status: "needs-action" | "behind" | "current"
  readonly needsAction: ReadonlyArray<NeedsAction>
  readonly pins: ReadonlyArray<Pin>
  readonly sets: ReadonlyArray<PinSet>
  readonly guards: ReadonlyArray<Guard>
  readonly files: ReadonlyArray<FileDrift>
  readonly seams: ReadonlyArray<Seam>
  readonly scripts: ReadonlyArray<ScriptDrift>
  readonly kept: ReadonlyArray<Kept>
  /** What `upgrade` applies, by kind, for the step that runs it. */
  readonly covers: ReadonlyArray<string>
  readonly steps: ReadonlyArray<UpgradeStep>
  readonly warnings: ReadonlyArray<string>
  /** The plan: file -> content after. Not in the JSON document. */
  readonly changes: ReadonlyMap<string, string>
  /** Files the plan removes. */
  readonly removes: ReadonlySet<string>
  /** node_modules no longer matches what the project declares (or will, after the plan). */
  readonly installOwed: boolean
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

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Text with CRLF line endings read as LF, as efforge wrote it. */
const lf = (s: string) => s.replace(/\r\n/g, "\n")
/** `text` in the line endings of `like`. */
const eolOf = (like: string | undefined, text: string) =>
  like?.includes("\r\n") === true ? lf(text).replace(/\n/g, "\r\n") : text

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

/**
 * Where a pin stands: the same as today's, behind (an efforge release pinned it: efforge's to
 * move), yours (no release did), or unmanaged. Not a semver guess: `1.0.0-rc.5-5935859` and
 * `1.0.0-rc.5` can't be ordered from the strings, but efforge knows which one it wrote.
 */
export const pinStatus = (
  made: string,
  name: string,
  project: string,
  efforge: string | undefined,
): PinStatus => {
  if (efforge === undefined) return "unmanaged"
  if (project === efforge) return "same"
  return efforgePinned(made, name, project) ? "behind" : "yours"
}

const pinsOf = (dir: string, made: string, catalog: Readonly<Record<string, string>>): Pin[] => {
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
        status: pinStatus(made, name, project, versions[name]),
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
            status: pinStatus(made, name, exact, versions[name]),
            where: file,
          }),
        )
      }
  }
  return out.toSorted((a, b) => byName(a.name, b.name))
}

/**
 * Holds the efforge pins of a set with a pin of yours (moving them would split it), and finds the
 * sets whose efforge pins no release pinned together: half moved. A pin of yours is your call;
 * whether the set still installs is doctor's `peers` check.
 */
const settle = (
  made: string,
  all: Pin[],
): { pins: Pin[]; sets: PinSet[]; fixable: ReadonlySet<string> } => {
  const pins = all.map((p) => {
    if (p.set === undefined || p.status !== "behind") return p
    const yours = all.some((q) => q.set === p.set && q.status === "yours")
    return yours ? { ...p, held: true } : p
  })
  const candidates = [
    ...releasesSince(made).map(([, r]) => r.pins),
    versions as Readonly<Record<string, string>>,
  ]
  const sets: PinSet[] = []
  const fixable = new Set<string>()
  for (const s of pinSets) {
    const members = pins.filter((p) => p.set === s.id && p.where === "catalog")
    if (members.length === 0) continue
    const efforges = members.filter((p) => p.status !== "yours")
    const explained = (version: (p: Pin) => string) =>
      candidates.some((c) =>
        efforges.every((p) => c[p.name] === undefined || c[p.name] === version(p)),
      )
    const after = (p: Pin) =>
      p.status === "behind" && p.held !== true ? (p.efforge as string) : p.project
    const split = efforges.length > 1 && !explained((p) => p.project)
    if (split && explained(after)) fixable.add(s.id)
    if (split || members.some((p) => p.status !== "same"))
      sets.push({ id: s.id, why: s.why, packages: members.map((p) => p.name), split })
  }
  return { pins, sets, fixable }
}

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

/** What a transform adds, for people: `section auth-secret`. */
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

/** Files no project keeps in git, and files only `doctor` asks about. */
const local = new Set([".dev.vars", ".env"])

const yamlKey = (k: string) => (/^[\w.-]+$/.test(k) ? k : `"${k}"`)

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export interface UpgradeOptions {
  readonly diff: boolean
  /** The efforge command for this project (`npx -y create-efforge`, plus `--cwd` when elsewhere). */
  readonly bin: (args: string) => string
  /** A shell command run in the project from where efforge was run (`cd <dir> && ...`). */
  readonly here: (command: string) => string
}

/** Compares the project in `dir` with what this efforge generates for its stack. Writes nothing. */
export const planUpgrade = (
  dir: string,
  manifest: EfforgeManifest,
  loaded: ReadonlyMap<string, LoadedAddon>,
  opts: UpgradeOptions,
): Effect.Effect<
  UpgradeReport,
  GenerateError | TransformAnchorMissing | UnknownTransform,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const stack = manifest.stack
    const name = stack.name
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
        `This project was made or upgraded with efforge ${made}, newer than this CLI (${efforgeVersion}), so this compares it with older templates. Use npx -y create-efforge@${made} or @latest.`,
      )

    const disk = new Map<string, string | undefined>()
    const at = (rel: string) => {
      if (!disk.has(rel)) disk.set(rel, read(dir, rel))
      return disk.get(rel)
    }
    const changes = new Map<string, string>()
    const removes = new Set<string>()
    const seamNotes = new Map<string, string[]>()
    const note = (file: string, what: string) =>
      seamNotes.set(file, [...(seamNotes.get(file) ?? []), what])

    // versions
    const workspace = readWorkspace(dir)
    let pkg: Record<string, unknown> = {}
    try {
      pkg = record(JSON.parse(at("package.json") ?? "{}"))
    } catch {}
    const found = pinsOf(dir, made, workspace.catalog)
    const pnpm = pinnedPnpm(pkg.packageManager)
    if (pnpm !== undefined)
      found.push({
        name: "pnpm",
        project: pnpm,
        efforge: pnpmVersion,
        status: pinStatus(made, "pnpm", pnpm, pnpmVersion),
        where: "packageManager",
      })
    const { pins, sets, fixable } = settle(made, found)
    const moves = pins.filter((p) => p.status === "behind" && p.held !== true)

    // guards (ADR 0005): held at the effect the catalog will have
    const effectPin = pins.find((p) => p.name === "effect" && p.where === "catalog")
    const effect =
      effectPin === undefined
        ? undefined
        : moves.includes(effectPin)
          ? effectVersion
          : effectPin.project
    const current = workspace.catalog.effect
    const missingKeys = current === undefined ? [] : missingOverrides(workspace.overrides, current)
    const guards: Guard[] = []
    if (current !== undefined)
      guards.push({
        id: "effect-overrides",
        ok: missingKeys.length === 0,
        message:
          missingKeys.length === 0
            ? `Every Effect package is held at effect ${current}.`
            : `${missingKeys.length === Object.keys(effectOverrides(current)).length ? "pnpm-workspace.yaml has no overrides holding Effect's packages" : `pnpm-workspace.yaml doesn't hold every Effect package (${missingKeys.join(", ")})`} at effect ${current}. A library that asks for a newer one then installs it next to the older effect and the build breaks, as 0.2.0 projects did when Effect 4.1 shipped.`,
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

    // today's templates for the project's own stack
    const addons = addonIdsFor(stack).flatMap((id) => {
      const a = loaded.get(id)
      return a === undefined ? [] : [a]
    })
    const today = yield* generate(stack, loaded)
    const todayHashes = record(
      (() => {
        try {
          return record(parseJsonc(today.get("efforge.jsonc") ?? "")).files
        } catch {
          return {}
        }
      })(),
    )

    // generated files
    const files: FileDrift[] = []
    const rehash = new Map<string, string>() // file -> hash to record
    const unhash = new Set<string>()
    for (const [path, recorded] of Object.entries(manifest.files)) {
      const text = at(path)
      const template = today.get(path)
      const edited = text !== undefined && hash(text) !== recorded && hash(lf(text)) !== recorded
      if (template === undefined) {
        files.push({ path, status: "dropped" })
        // efforge's own, unedited, and no longer generated: it goes, unless something imports it
        if (text !== undefined && !edited) {
          removes.add(path)
          unhash.add(path)
        }
        continue
      }
      if (text === undefined) {
        files.push({ path, status: "deleted" })
        continue
      }
      const moved = hash(template) !== recorded
      const s: FileStatus =
        lf(text) === template
          ? "current"
          : !edited
            ? moved
              ? "refresh"
              : "current"
            : moved
              ? "review"
              : "yours"
      if (s === "current" && hash(template) !== recorded && typeof todayHashes[path] === "string")
        rehash.set(path, todayHashes[path]) // taken whole from efforge: record it as efforge's
      if (s === "refresh") {
        changes.set(path, eolOf(text, template))
        if (typeof todayHashes[path] === "string") rehash.set(path, todayHashes[path])
      }
      files.push({ path, status: s })
    }
    // files efforge edits in place, judged by what releases wrote
    const inPlace = new Set<string>()
    for (const [path, template] of today) {
      if (path in manifest.files || isComputed(path) || local.has(path)) continue
      const text = at(path)
      const hashed = typeof todayHashes[path] === "string"
      if (!hashed) inPlace.add(path)
      if (text === undefined) {
        // in-place files a release generated and the owner removed stay removed; anything else is new
        if (!hashed && efforgeGenerated(made, path))
          files.push({ path, status: "deleted", inPlace: true })
        else {
          files.push({ path, status: "new", ...(hashed ? {} : { inPlace: true }) })
          changes.set(path, template)
          if (hashed) rehash.set(path, todayHashes[path] as string)
        }
        continue
      }
      if (hashed) {
        // a file today hashes that the manifest doesn't: written by hand, or by an older release
        // that edited it in place
        const s =
          lf(text) === template
            ? "current"
            : compareWithRecord(text, template, recordFor(made, path), name)
        files.push({ path, status: s })
        if (s === "current") rehash.set(path, todayHashes[path] as string)
        if (s === "refresh") {
          changes.set(path, eolOf(text, template))
          rehash.set(path, todayHashes[path] as string)
        }
        continue
      }
      const s =
        lf(text) === template || sameStructure(path, text, template)
          ? "current"
          : compareWithRecord(text, template, recordFor(made, path), name)
      files.push({ path, status: s, inPlace: true })
      if (s === "refresh") changes.set(path, eolOf(text, template))
    }
    // in-place files releases generated that efforge no longer does: removed when still efforge's
    for (const [, r] of releasesSince(made))
      for (const path of Object.keys(r.records)) {
        if (today.has(path) || files.some((f) => f.path === path)) continue
        const text = at(path)
        if (text === undefined) continue
        const own = onlyEfforgeOwn(text, "", recordFor(made, path), name)
        files.push({ path, status: "dropped", inPlace: true })
        if (own) removes.add(path)
      }

    // new pieces in files you changed that efforge edits in place: a transform's addition is applied
    // when no release wrote any of it (new in this efforge); one a release wrote that is missing
    // now is something you removed, and stays removed
    for (const { manifest: m } of addons)
      for (const t of activeTransforms(m, stack, (f) => (changes.get(f) ?? at(f)) !== undefined)) {
        const targets = transformTargets(t)
        if (!targets.every((f) => inPlace.has(f))) continue
        const owned = targets.filter((f) => {
          const st = files.find((x) => x.path === f)?.status
          return st === "review" || st === "yours"
        })
        if (owned.length === 0) continue
        const tree = new Map<string, string>()
        for (const f of targets) {
          const text = changes.get(f) ?? at(f)
          if (text !== undefined) tree.set(f, text)
        }
        const next = yield* runTransform(tree, t).pipe(
          Effect.catchTag("TransformAnchorMissing", () =>
            Effect.succeed(tree as ReadonlyMap<string, string>),
          ),
        )
        for (const f of owned) {
          const before = tree.get(f)
          const after = next.get(f)
          if (before === undefined || after === undefined || after === before) continue
          const rec = recordFor(made, f)
          if (rec === undefined) continue
          const was = shingles(before, name)
          const added = [...shingles(after, name)].filter((x) => !was.has(x))
          if (added.some((x) => rec.has(x))) continue // a release wrote it: you removed it
          changes.set(f, after)
          note(f, `${describe(t)} (${m.id})`)
        }
      }

    // package.json files: pins, scripts, dependencies and engines that are efforge's to move
    const scripts: ScriptDrift[] = []
    const todayCatalog = readCatalogText(today.get("pnpm-workspace.yaml"))
    const newCatalog = new Map<string, string>()
    const packageText = (path: string) => changes.get(path) ?? at(path)
    const setPackage = (path: string, data: Record<string, unknown>) => {
      const before = at(path)
      if (before === undefined) return
      const after = packageJson(data, packageText(path) as string)
      if (after !== packageText(path)) changes.set(path, after)
    }
    for (const [path, text] of today) {
      if (path !== "package.json" && !path.endsWith("/package.json")) continue
      const before = at(path)
      if (before === undefined) {
        // a workspace package the stack has today and the project doesn't
        changes.set(path, text)
        note(path, "the whole file")
        continue
      }
      let mine: Record<string, unknown>
      try {
        mine = record(JSON.parse(before))
      } catch {
        continue
      }
      const want = record(JSON.parse(text))
      const next: Record<string, unknown> = { ...mine }
      for (const field of ["dependencies", "devDependencies"] as const) {
        const have = record(mine[field])
        const add = Object.entries(record(want[field])).filter(
          ([dep]) => !(dep in have) && !efforgeDeclared(made, path, dep),
        )
        if (add.length === 0) continue
        const merged: Record<string, unknown> = { ...have }
        for (const [dep, spec] of add) {
          merged[dep] = spec
          note(path, `${field === "devDependencies" ? "devDependency" : "dependency"} ${dep}`)
          if (spec === "catalog:" && workspace.catalog[dep] === undefined)
            newCatalog.set(dep, todayCatalog[dep] ?? versions[dep] ?? "")
        }
        next[field] = sortedLike(have, merged)
      }
      const have = record(mine.scripts)
      const nextScripts: Record<string, unknown> = { ...have }
      for (const [script, cmd] of Object.entries(record(want.scripts))) {
        const own = scalar(have[script])
        if (own === undefined) {
          // a script no release wrote here is new; one a release wrote is one you removed
          if (!releasesSince(made).some(([, r]) => r.scripts[path]?.[script] !== undefined)) {
            nextScripts[script] = cmd
            note(path, `script ${script}`)
          }
          continue
        }
        if (own === cmd) continue
        const efforges = efforgeScript(made, path, script, own)
        scripts.push({
          file: path,
          name: script,
          yours: own,
          efforge: String(cmd),
          status: efforges ? "behind" : "yours",
        })
        if (efforges) nextScripts[script] = cmd
      }
      if (JSON.stringify(nextScripts) !== JSON.stringify(have)) next.scripts = nextScripts
      if (path === "package.json") {
        if (want.engines !== undefined) {
          if (mine.engines === undefined) {
            if (enginesNew(made)) {
              next.engines = want.engines
              note(path, "engines")
            }
          } else if (
            JSON.stringify(mine.engines) !== JSON.stringify(want.engines) &&
            releasesSince(made).some(
              ([, r]) => JSON.stringify(r.engines) === JSON.stringify(mine.engines),
            )
          )
            next.engines = want.engines
        }
        const pm = pins.find((p) => p.where === "packageManager")
        if (!pmOk || (pm !== undefined && moves.includes(pm)))
          next.packageManager = `pnpm@${pnpmVersion}`
      }
      // exact pins of a package built in its own Docker context
      for (const p of moves)
        if (p.where === path)
          for (const field of ["dependencies", "devDependencies"] as const)
            if (record(next[field])[p.name] !== undefined)
              next[field] = { ...record(next[field]), [p.name]: p.efforge }
      setPackage(path, next)
    }

    // pnpm-workspace.yaml: the guard, the pins, and catalog entries for new dependencies
    const fixGuard = effect !== undefined && (missingKeys.length > 0 || effect !== current)
    const workspaceChange = (extra: ReadonlyMap<string, string>) => {
      const text = workspace.text
      const catalogMoves = moves.filter((p) => p.where === "catalog")
      if (text === undefined || (!fixGuard && catalogMoves.length === 0 && extra.size === 0)) return
      const doc = parseDocument(text)
      for (const p of catalogMoves) doc.setIn(["catalog", p.name], p.efforge)
      for (const [dep, version] of extra) doc.setIn(["catalog", dep], version)
      if (extra.size > 0) {
        const catalog = record(
          (doc.getIn(["catalog"]) as { toJSON(): unknown } | undefined)?.toJSON(),
        )
        doc.setIn(
          ["catalog"],
          Object.fromEntries(Object.entries(catalog).toSorted(([a], [b]) => byName(a, b))),
        )
      }
      if (fixGuard && effect !== undefined)
        for (const [key, version] of Object.entries(effectOverrides(effect)))
          doc.setIn(
            [
              "overrides",
              key.startsWith("effect@") && doc.hasIn(["overrides", "effect"]) ? "effect" : key,
            ],
            version,
          )
      const after = doc.toString()
      if (after !== text) changes.set("pnpm-workspace.yaml", eolOf(text, after))
      else changes.delete("pnpm-workspace.yaml")
    }
    workspaceChange(newCatalog)

    // keep the plan a consistent set: what the new files import, and what your files import
    const sources = sourceFiles((rel) => {
      try {
        return readdirSync(join(dir, rel), { withFileTypes: true }).map((e) => ({
          name: e.name,
          dir: e.isDirectory(),
        }))
      } catch {
        return []
      }
    })
    const types = typeProbe(dir, changes, removes)
    const consistency = checkConsistency({
      name,
      typeOf: types.typeOf,
      disk: (p) => at(p),
      sources,
      today,
      changes,
      removes,
      inPlace: (p) => inPlace.has(p),
      deleted: (p) => files.some((f) => f.path === p && f.status === "deleted"),
      efforgeOwn: (p, text) => onlyEfforgeOwn(text, today.get(p) ?? "", recordFor(made, p), name),
      removedDependency: (file, dep) => efforgeDeclared(made, file, dep),
      addDependency: (file, dep) => {
        const want = record(JSON.parse(today.get(file) ?? "{}"))
        const field =
          dep in record(want.dependencies)
            ? "dependencies"
            : dep in record(want.devDependencies)
              ? "devDependencies"
              : undefined
        const text = packageText(file)
        if (field === undefined || text === undefined) return false
        const data = record(JSON.parse(text))
        const spec = record(want[field])[dep]
        data[field] = sortedLike(record(data[field]), { ...record(data[field]), [dep]: spec })
        setPackage(file, data)
        note(file, `${field === "devDependencies" ? "devDependency" : "dependency"} ${dep}`)
        if (spec === "catalog:" && workspace.catalog[dep] === undefined) {
          newCatalog.set(dep, todayCatalog[dep] ?? versions[dep] ?? "")
          workspaceChange(newCatalog)
        }
        return true
      },
    })
    for (const s of consistency.seams) note(s.file, s.what)
    const heldFiles = new Map(consistency.holds.map((h) => [h.path, h]))
    for (const h of consistency.holds) {
      rehash.delete(h.path)
      unhash.delete(h.path)
    }

    // efforge.jsonc: the version this project now matches, and the hashes of what efforge wrote
    const manifestText = at("efforge.jsonc")
    const anyChange = changes.size > 0 || removes.size > 0
    const staleHashes = [...rehash].filter(([p, h]) => manifest.files[p] !== h)
    const needsVersion = made !== efforgeVersion && project.status !== "ahead"
    if (manifestText !== undefined && (anyChange || staleHashes.length > 0 || needsVersion)) {
      let text = manifestText
      const fmt = {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
          eol: manifestText.includes("\r\n") ? "\r\n" : "\n",
        },
      }
      if (needsVersion)
        text = applyEdits(text, modify(text, ["efforgeVersion"], efforgeVersion, fmt))
      const entries = { ...manifest.files }
      for (const [p, h] of staleHashes) entries[p] = h
      for (const p of unhash) if (removes.has(p)) delete entries[p]
      const sorted = Object.fromEntries(
        Object.entries(entries).toSorted(([a], [b]) => byName(a, b)),
      )
      if (JSON.stringify(sorted) !== JSON.stringify(manifest.files))
        text = applyEdits(text, modify(text, ["files"], sorted, fmt))
      if (text !== manifestText) changes.set("efforge.jsonc", text)
    }

    // what is held back, and why
    const why = (path: string) => upgradeNote(path)
    const filesOut: FileDrift[] = files
      .map((f) => {
        const out: { -readonly [K in keyof FileDrift]: FileDrift[K] } = Object.assign({}, f)
        const h = heldFiles.get(f.path)
        if (h !== undefined)
          out.held =
            h.lines === undefined ? { reason: h.reason } : { reason: h.reason, lines: h.lines }
        const w =
          f.status === "refresh" || f.status === "new" || f.status === "review"
            ? why(f.path)
            : undefined
        if (w !== undefined) out.why = w
        if (opts.diff && f.status !== "current" && f.status !== "deleted" && f.status !== "yours")
          out.diff = gitDiff(f.path, at(f.path), today.get(f.path) ?? "")
        return out
      })
      .toSorted((a, b) => byName(a.path, b.path))

    const seams: Seam[] = [...seamNotes]
      .filter(([file]) => changes.has(file))
      .map(([file, missing]) => ({
        file,
        missing: [...new Set(missing)],
        diff: gitDiff(file, at(file), changes.get(file) as string),
      }))
      .toSorted((a, b) => byName(a.file, b.file))

    const kept: Kept[] = [
      ...filesOut
        .filter((f) => f.status === "review")
        .map((f): Kept => ({
          path: f.path,
          status: "review",
          reason: `You changed it, and efforge's template changed too${f.why === undefined ? "" : `: ${f.why}`}. ${f.inPlace === true ? "efforge added what its new files need, if anything; the rest is yours to take or leave" : "efforge leaves it as it is"}.`,
        })),
      ...consistency.holds.map((h): Kept => ({
        path: h.path,
        status: "held",
        reason: `efforge keeps it as it is: ${h.reason}.`,
        ...(h.lines === undefined ? {} : { lines: h.lines }),
      })),
    ].toSorted((a, b) => byName(a.path, b.path))

    // what breaks the project now
    const needsAction: NeedsAction[] = []
    const upgradeCmd = opts.bin("upgrade")
    for (const g of guards)
      if (!g.ok) needsAction.push({ id: g.id, message: g.message, fix: upgradeCmd })
    for (const s of sets)
      if (s.split)
        needsAction.push({
          id: "split-set",
          message: `The ${s.id} pins aren't ones efforge pinned together (${s.why}): ${pins
            .filter((p) => p.set === s.id && p.where === "catalog")
            .map((p) => `${p.name} ${p.project}${p.status === "yours" ? " (yours)" : ""}`)
            .join(", ")}. Move them as one.`,
          fix: fixable.has(s.id) ? upgradeCmd : null,
          lines: `catalog:\n${pins
            .filter((p) => p.set === s.id && p.efforge !== null && p.where === "catalog")
            .map((p) => `  ${yamlKey(p.name)}: ${p.efforge}`)
            .join("\n")}`,
        })
    for (const b of consistency.broken) {
      const fixed = changes.has(b.to)
      needsAction.push({
        id: "missing-seam",
        message: `${b.from} imports ${b.what} from ${b.to}, which ${b.to} lacks, so the build fails.${fixed ? " upgrade adds it." : ""}`,
        fix: fixed ? upgradeCmd : null,
      })
    }
    const installed = read(dir, "node_modules/.modules.yaml") !== undefined
    const owed = installed && installOwed(dir)
    if (owed)
      needsAction.push({
        id: "install",
        message:
          "node_modules doesn't match the package.json files, pnpm-workspace.yaml or pnpm-lock.yaml: something changed them after the last install, or an install didn't finish.",
        fix: opts.here("pnpm install"),
      })

    const covers = [
      ...(fixGuard ? ["effect-overrides"] : []),
      ...(!pmOk ? ["package-manager"] : []),
      ...(moves.length > 0 ? ["pins"] : []),
      ...(scripts.some((s) => s.status === "behind") ? ["scripts"] : []),
      ...(seams.length > 0 ? ["seams"] : []),
      ...(filesOut.some((f) => f.status === "refresh" && f.held === undefined) ? ["refresh"] : []),
      ...(filesOut.some((f) => f.status === "new" && f.held === undefined) ? ["new"] : []),
      ...(removes.size > 0 ? ["remove"] : []),
      ...(changes.has("efforge.jsonc") ? ["manifest"] : []),
    ]
    const depsChange = [...changes.keys()].some(
      (f) => f.endsWith("package.json") || f === "pnpm-workspace.yaml",
    )
    const installAfter = depsChange || owed
    const behind = changes.size > 0 || removes.size > 0
    const status = needsAction.length > 0 ? "needs-action" : behind ? "behind" : "current"

    // what to do, in order
    const steps: UpgradeStep[] = []
    if (behind)
      steps.push({
        id: "upgrade",
        description: `Apply what efforge can, leaving your changes alone: ${summary(filesOut, moves.length, seams, scripts, removes.size, fixGuard || !pmOk)}${installAfter ? ", then pnpm install" : ""}. It writes nothing if any step fails, and refuses uncommitted changes so git diff shows exactly what it did.`,
        command: `${BIN} upgrade`,
        cwd: dir,
        covers: [...covers, ...(installAfter ? ["install"] : [])],
      })
    for (const n of needsAction)
      if (n.fix === null)
        steps.push({
          id: n.id,
          description: n.message,
          ...(n.lines === undefined ? {} : { file: "pnpm-workspace.yaml", lines: n.lines }),
        })
    if (!behind && owed)
      steps.push({
        id: "install",
        description: "Install what the project declares.",
        command: "pnpm install",
        cwd: dir,
      })
    if (kept.length > 0)
      steps.push({
        id: "review",
        description: `${plural(kept.length, "file")} efforge won't change for you: ${kept.some((k) => k.status === "review") ? "you changed them and so did its templates" : "held back to keep the project consistent"}. Each has the reason; the diff shows efforge's version against yours.`,
        command: `${BIN} upgrade --check --diff`,
        cwd: dir,
        files: kept.map((k) => k.path),
      })
    if (steps.length > 0)
      steps.push({
        id: "gate",
        description: "Check the project passes its gate.",
        command: "pnpm typecheck && pnpm check && pnpm test && pnpm build",
        cwd: dir,
      })
    return {
      directory: dir,
      stack,
      project,
      status,
      needsAction,
      pins,
      sets,
      guards,
      files: filesOut,
      seams,
      scripts,
      kept,
      covers,
      steps,
      warnings,
      changes,
      removes,
      installOwed: installAfter,
    }
  })

const summary = (
  files: ReadonlyArray<FileDrift>,
  pins: number,
  seams: ReadonlyArray<Seam>,
  scripts: ReadonlyArray<ScriptDrift>,
  removed: number,
  guard: boolean,
) => {
  const n = (s: FileStatus) => files.filter((f) => f.status === s && f.held === undefined).length
  return (
    [
      guard ? "the Effect guard" : undefined,
      pins > 0 ? plural(pins, "pin") : undefined,
      scripts.some((s) => s.status === "behind")
        ? plural(scripts.filter((s) => s.status === "behind").length, "script")
        : undefined,
      n("refresh") > 0 ? `${plural(n("refresh"), "file")} refreshed` : undefined,
      n("new") > 0 ? `${n("new")} added` : undefined,
      seams.length > 0 ? `${plural(seams.length, "file")} given what the new ones need` : undefined,
      removed > 0 ? `${removed} it no longer generates removed` : undefined,
    ]
      .filter((x) => x !== undefined)
      .join(", ") || "efforge.jsonc"
  )
}

/** `before` -> `after` as a git diff of one file; "" when equal. */
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

/** `merged` in the order of `have`: sorted when `have` was sorted. */
const sortedLike = (have: Record<string, unknown>, merged: Record<string, unknown>) => {
  const keys = Object.keys(have)
  const sorted = keys.every((k, i) => i === 0 || byName(keys[i - 1] as string, k) <= 0)
  return sorted
    ? Object.fromEntries(Object.entries(merged).toSorted(([a], [b]) => byName(a, b)))
    : merged
}

/** The order efforge's package.json files keep their keys in (what the formatter sorts to). */
const PACKAGE_KEYS = [
  "name",
  "version",
  "private",
  "type",
  "exports",
  "main",
  "scripts",
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "engines",
  "packageManager",
]

/**
 * package.json text for `pkg`, in the file's indent and key order; a key it didn't have goes
 * before the first key that follows it in efforge's order (`engines` before `packageManager`).
 */
const packageJson = (pkg: Record<string, unknown>, before: string): string => {
  const indent = /^([ \t]+)"/m.exec(before)?.[1] ?? "  "
  const old = record(JSON.parse(before))
  if (JSON.stringify(old) === JSON.stringify(pkg)) return before
  const keys = Object.keys(old).filter((k) => k in pkg)
  for (const k of Object.keys(pkg).filter((x) => !(x in old))) {
    const rank = PACKAGE_KEYS.indexOf(k)
    const at = rank < 0 ? -1 : keys.findIndex((x) => PACKAGE_KEYS.indexOf(x) > rank)
    if (at < 0) keys.push(k)
    else keys.splice(at, 0, k)
  }
  const ordered = Object.fromEntries(keys.map((k) => [k, pkg[k]]))
  const next = `${JSON.stringify(ordered, null, indent)}${before.endsWith("\n") ? "\n" : ""}`
  return eolOf(before, next)
}

const readCatalogText = (text: string | undefined): Record<string, string> => {
  try {
    const catalog = record(record(parseDocument(text ?? "").toJS()).catalog)
    return Object.fromEntries(Object.entries(catalog).map(([k, v]) => [k, String(v)]))
  } catch {
    return {}
  }
}
