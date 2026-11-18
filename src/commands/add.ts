import { existsSync, readdirSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { Effect, FileSystem, Path, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import type { ChildProcessSpawner } from "effect/process"
import { type ParseError, parse } from "jsonc-parser"
import pc from "picocolors"
import { parseDocument } from "yaml"
import { type AddonLoadError, addonIdsFor, loadAddons } from "../addon.ts"
import {
  commandLine,
  distance,
  type Failure,
  inDir,
  insertAt,
  internal,
  Invocation,
  positionals,
  printSuccess,
  replaceAt,
  report,
  setFlag,
} from "../contract.ts"
import { unifiedDiff } from "../diff.ts"
import { type CommandFailed, exec, has } from "../exec.ts"
import { GenerateError, generate, isComputed, matches } from "../generate.ts"
import { EfforgeManifest, hash, renderManifest } from "../manifest.ts"
import { applyProjectName } from "../projectName.ts"
import { generateRouteTree } from "../routeTree.ts"
import { IncompatibleStack, validate } from "../rules.ts"
import { type SlotDef, slots } from "../slots.ts"
import { type StackConfig, toCommand } from "../stack.ts"
import { WRANGLER_FILE } from "../transforms/addWranglerBinding.ts"
import {
  runTransform,
  transformTargets,
  type TransformAnchorMissing,
  type UnknownTransform,
} from "../transforms/index.ts"
import { PromptIO, type PromptIOShape } from "../prompts/navigable.ts"
import {
  effectOverrides,
  effectVersion,
  efforgeVersion,
  isEffectLockstep,
  versions,
} from "../versions.ts"
import {
  assigns,
  type EnvVar,
  localEnvFile,
  PnpmMissing,
  type Step,
  TemplatesDir,
} from "./create.ts"

export class NotAnEfforgeProject extends Schema.TaggedError<NotAnEfforgeProject>()(
  "NotAnEfforgeProject",
  { dir: Schema.String, reason: Schema.String },
) {}

/** An id that names no add-on (a typo), or more than one (`auth`): `suggestions` are full ids. */
export class UnknownAddon extends Schema.TaggedError<UnknownAddon>()("UnknownAddon", {
  id: Schema.String,
  message: Schema.String,
  suggestions: Schema.Array(Schema.String),
}) {}

/** `ai/none` and friends: removing an add-on isn't supported yet. */
export class RemoveNotSupported extends Schema.TaggedError<RemoveNotSupported>()(
  "RemoveNotSupported",
  { id: Schema.String },
) {}

/** A single-choice slot already holds another value; `add` only moves a slot from `none`. */
export class SlotAlreadySet extends Schema.TaggedError<SlotAlreadySet>()("SlotAlreadySet", {
  slot: Schema.String,
  current: Schema.String,
  value: Schema.String,
}) {}

/** A target file that exists, differs from what efforge generated, and `--overwrite` wasn't given. */
export class OverlayConflict extends Schema.TaggedError<OverlayConflict>()("OverlayConflict", {
  file: Schema.String,
  files: Schema.Array(Schema.String),
  diff: Schema.String,
}) {}

export interface AddOptions {
  readonly overwrite: boolean
  readonly dryRun: boolean
  /** Run `pnpm install` afterwards (default true; never when `dryRun`). */
  readonly install?: boolean
}

export interface AddResult {
  /** Overlay files created or replaced, plus package.json, workspace, env and manifest updates. */
  readonly written: string[]
  /** The subset of `written` that didn't exist before. */
  readonly created: string[]
  /** Existing seam files edited by transforms. */
  readonly transformed: string[]
  /** Ids already in the stack, and overlays that already match. */
  readonly skipped: string[]
  /** Generated files the add-on replaces (e.g. wrangler.jsonc for infra/alchemy). */
  readonly removed: string[]
  /** Add-ons this run added, for the summary and next steps. */
  readonly added: ReadonlyArray<{
    readonly id: string
    readonly title: string
    readonly docs?: string
  }>
  /** Env vars this run added to `.env.example`, and where their local values live. */
  readonly envVars: ReadonlyArray<EnvVar>
  /** `<package.json>: <script>` entries whose existing command an add-on replaced. */
  readonly replacedScripts: string[]
  /** The project's stack after this run. */
  readonly stack: StackConfig
}

export type AddError =
  | NotAnEfforgeProject
  | UnknownAddon
  | RemoveNotSupported
  | SlotAlreadySet
  | IncompatibleStack
  | OverlayConflict
  | TransformAnchorMissing
  | UnknownTransform
  | GenerateError
  | AddonLoadError
  | CommandFailed

const incompatible = (
  slot: IncompatibleStack["slot"],
  value: string,
  allowed: string[],
  reason: string,
  needs: string[],
) => new IncompatibleStack({ slot, value, allowed, reason, needs })

const allIds = slots.flatMap((s) =>
  s.options.filter((o) => o.id !== "none").map((o) => `${s.id}/${o.id}`),
)

/** Full ids close to `id`: a slot name or fragment ("ai", "auth", "better") first, then a typo. */
const suggest = (id: string): string[] => {
  const partial = allIds.filter((full) => full.split("/").some((part) => part.startsWith(id)))
  if (partial.length > 0) return partial
  const best = allIds
    .flatMap(
      (full) =>
        [
          [full, full],
          [full, full.split("/")[1] as string],
        ] as const,
    )
    .map(([full, c]) => [full, distance(id, c)] as const)
    .toSorted((a, b) => a[1] - b[1])[0]
  return best !== undefined && best[1] <= 3 ? [best[0]] : []
}

/** Same JSONC data and comments, ignoring formatting, key order and array order (earlier `add`s reorder bindings). */
const sameJsonc = (a: string, b: string | undefined): boolean => {
  if (b === undefined) return false
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon).toSorted((x, y) => byName(JSON.stringify(x), JSON.stringify(y)))
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .toSorted(([x], [y]) => byName(x, y))
              .map(([k, x]) => [k, canon(x)]),
          )
        : v
  const read = (t: string) => {
    const errors: ParseError[] = []
    const v = parse(t, errors, { allowTrailingComma: true }) as unknown
    return errors.length > 0 ? undefined : JSON.stringify(canon(v))
  }
  // comments are user content too, and the parser drops them
  const comments = (t: string) =>
    (t.match(/\/\/.*$|\/\*[\s\S]*?\*\//gm) ?? [])
      .map((c) => c.trim())
      .toSorted()
      .join("\n")
  const x = read(a)
  return x !== undefined && x === read(b) && comments(a) === comments(b)
}

const isNewPackageJson = (target: string) => target.endsWith("/package.json")

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** `email`, `extras/email`, `ai/effect-ai-byok`, `ai=effect-ai-byok`, `ai` (a slot with one option) -> slot + option. */
const parseId = (
  raw: string,
): Effect.Effect<{ slot: SlotDef; option: string }, UnknownAddon | RemoveNotSupported> => {
  const id = raw.trim().toLowerCase()
  const [slotPart, option = ""] = id.includes("=")
    ? id.split("=", 2)
    : id.includes("/")
      ? id.split("/", 2)
      : [undefined, id]
  if (option === "none") return Effect.fail(new RemoveNotSupported({ id: raw }))
  // a bare slot name with exactly one add-on to add: `ai`, `infra`
  if (slotPart === undefined) {
    const named = slots.find((s) => s.id === option)
    const choices = named?.options.filter((o) => o.id !== "none") ?? []
    if (named !== undefined && choices.length === 1 && named.options.length > 1)
      return Effect.succeed({ slot: named, option: (choices[0] as { id: string }).id })
  }
  const candidates = slots.filter(
    (s) => (slotPart === undefined || s.id === slotPart) && s.options.some((o) => o.id === option),
  )
  const [first] = candidates
  if (first === undefined) {
    const suggestions = suggest(id)
    return Effect.fail(
      new UnknownAddon({
        id: raw,
        suggestions,
        message: `"${raw}" is not an add-on.${suggestions.length === 0 ? "" : ` Did you mean ${suggestions.join(" or ")}?`} See them all with npx create-efforge list.`,
      }),
    )
  }
  if (candidates.length > 1) {
    const suggestions = candidates.map((s) => `${s.id}/${option}`)
    return Effect.fail(
      new UnknownAddon({
        id: raw,
        suggestions,
        message: `"${raw}" is ambiguous; write it as ${suggestions.join(" or ")}.`,
      }),
    )
  }
  return Effect.succeed({ slot: first, option })
}

/** Applies `ids` to `stack`. Single-select slots may only go from `none` to a value. */
const applyIds = (
  stack: StackConfig,
  ids: ReadonlyArray<string>,
): Effect.Effect<
  { stack: StackConfig; skipped: string[] },
  IncompatibleStack | UnknownAddon | RemoveNotSupported | SlotAlreadySet
> =>
  Effect.gen(function* () {
    let next = stack
    const skipped: string[] = []
    for (const id of ids) {
      const { slot, option } = yield* parseId(id)
      if (slot.id === "extras") {
        if (next.extras.includes(option as never)) skipped.push(`extras/${option}`)
        else {
          const order = slot.options.map((o) => o.id)
          const extras = [...next.extras, option as never].toSorted(
            (a, b) => order.indexOf(a) - order.indexOf(b),
          )
          next = { ...next, extras }
        }
        continue
      }
      const current = next[slot.id]
      if (current === option) skipped.push(`${slot.id}/${option}`)
      else if (current === "none") next = { ...next, [slot.id]: option }
      else return yield* new SlotAlreadySet({ slot: slot.id, current, value: option })
    }
    const valid = yield* validate(next).pipe(
      Effect.mapError((e) => {
        // the stack rules hold across slots: say which ids to add together
        const typed = ids.map((x) => x.trim().toLowerCase())
        const hasOrm = typed.some(
          (x) => x.startsWith("orm/") || x === "drizzle" || x === "effect-sql",
        )
        if (next.database === "none" && (e.slot === "orm" || e.slot === "auth")) {
          const needs = ["database/d1", ...(hasOrm ? [] : ["orm/effect-sql"])]
          return incompatible(
            e.slot,
            e.value,
            [...e.allowed],
            `${e.slot === "auth" ? "auth" : "an ORM"} needs a database, and this project has none. Add one in the same command: npx create-efforge add ${[...needs, ...typed].join(" ")}`,
            needs,
          )
        }
        if (e.slot === "orm" && next.orm === "none")
          return incompatible(
            "database",
            next.database,
            [...e.allowed],
            `a database needs an ORM. Add one with it: npx create-efforge add ${typed.join(" ")} orm/drizzle (or orm/effect-sql)`,
            ["orm/drizzle"],
          )
        return e
      }),
    )
    return { stack: valid, skipped }
  })

export const readManifest = (
  dir: string,
): Effect.Effect<EfforgeManifest, NotAnEfforgeProject, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const fail = (reason: string) => new NotAnEfforgeProject({ dir, reason })
    if (!(yield* fs.exists(dir).pipe(Effect.orElseSucceed(() => false))))
      return yield* fail("the directory does not exist")
    const text = yield* fs
      .readFileString(path.join(dir, "efforge.jsonc"))
      .pipe(Effect.mapError(() => fail("efforge.jsonc not found")))
    const errors: ParseError[] = []
    const json = parse(text, errors, { allowTrailingComma: true }) as unknown
    if (errors.length > 0) return yield* fail("efforge.jsonc is not valid JSONC")
    return yield* Schema.decodeUnknownEffect(EfforgeManifest)(json).pipe(
      Effect.mapError((e) => fail(`efforge.jsonc is not a valid manifest: ${e.message}`)),
    )
  })

/**
 * Adds add-ons to an existing efforge project. Everything is computed in memory first
 * (overlays, transforms against the files on disk, dependency/env/manifest merges); nothing is
 * written unless all of it succeeds.
 */
export const addAddons = (
  dir: string,
  ids: ReadonlyArray<string>,
  opts: AddOptions,
): Effect.Effect<
  AddResult,
  AddError,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const templatesDir = yield* TemplatesDir
    const manifest = yield* readManifest(dir)
    const io = (target: string) =>
      Effect.mapError(
        (e: { message: string }) =>
          new GenerateError({ reason: "io", path: target, message: e.message }),
      )

    const disk = new Map<string, string | undefined>()
    const read = (rel: string) =>
      Effect.gen(function* () {
        if (disk.has(rel)) return disk.get(rel)
        const abs = path.join(dir, rel)
        const text = (yield* fs.exists(abs)) ? yield* fs.readFileString(abs) : undefined
        disk.set(rel, text)
        return text
      }).pipe(io(rel))

    // 1. resolve ids into the new stack
    const { stack, skipped: alreadyThere } = yield* applyIds(manifest.stack, ids)
    const before = new Set(addonIdsFor(manifest.stack))
    const newIds = addonIdsFor(stack).filter((id) => !before.has(id))
    const addons = yield* loadAddons(templatesDir)
    const fresh = []
    // every add-on of the new stack, in generate order: new ones apply fully, existing ones only
    // what the new choice switches on (e.g. infra=alchemy turns on their workflow secrets)
    const scope = []
    for (const id of addonIdsFor(stack)) {
      const a = addons.get(id)
      if (a === undefined)
        return yield* new GenerateError({
          reason: "unknown-addon",
          message: `add-on "${id}" is not loaded`,
        })
      scope.push(a)
      if (!before.has(id)) fresh.push(a)
    }
    const newSet = new Set(newIds)
    const switchedOn = (id: string, when: Parameters<typeof matches>[0]) =>
      matches(when, stack) && (newSet.has(id) || !matches(when, manifest.stack))

    const skipped: string[] = [...alreadyThere]
    const out = new Map<string, string>() // path -> new content, everything to write
    const written = new Set<string>()
    const hashes: Record<string, string> = {}

    // 2. overlays: write if absent, replace if still what efforge generated, else conflict
    const overlays = new Map<string, string>()
    for (const { manifest: m, dir: addonDir } of scope)
      for (const f of m.files) {
        if (!switchedOn(m.id, f.when)) continue
        // package.json files are merged, not replaced: only a new workspace package's is created
        if (isComputed(f.target) && !(isNewPackageJson(f.target) && !(yield* read(f.target))))
          continue
        overlays.set(
          f.target,
          yield* fs.readFileString(path.join(addonDir, f.path)).pipe(io(f.path)),
        )
      }
    const safe = (rel: string) => {
      const r = path.relative(dir, path.resolve(dir, rel))
      return (
        rel !== "" &&
        !path.isAbsolute(rel) &&
        r !== "" &&
        !r.startsWith("..") &&
        !path.isAbsolute(r)
      )
    }
    for (const target of overlays.keys())
      if (!safe(target))
        return yield* new GenerateError({
          reason: "unsafe-path",
          path: target,
          message: `add-on target "${target}" is outside the project directory`,
        })
    const tree = new Map<string, string>()
    const conflicts: Array<{ file: string; diff: string }> = []
    for (const [target, content] of applyProjectName(overlays, stack.name)) {
      const existing = yield* read(target)
      if (existing === content) {
        skipped.push(target)
      } else if (
        existing === undefined ||
        opts.overwrite ||
        manifest.files[target] === hash(existing)
      ) {
        out.set(target, content)
        written.add(target)
      } else {
        conflicts.push({ file: target, diff: unifiedDiff(target, existing, content) })
        continue
      }
      if (!isComputed(target)) hashes[target] = hash(content)
      tree.set(target, content)
    }
    if (conflicts.length > 0)
      return yield* new OverlayConflict({
        file: conflicts.map((c) => c.file).join(", "),
        files: conflicts.map((c) => c.file),
        diff: conflicts.map((c) => c.diff).join("\n"),
      })

    // 2b. files the new stack no longer generates (wrangler.jsonc once alchemy declares the Worker)
    const removed = new Set<string>()
    if (
      newIds.includes("infra/alchemy") &&
      manifest.stack.infra === "none" &&
      (yield* read(WRANGLER_FILE)) !== undefined
    ) {
      const existing = (yield* read(WRANGLER_FILE)) as string
      const generated = (yield* generate(manifest.stack, addons)).get(WRANGLER_FILE)
      if (
        opts.overwrite ||
        sameJsonc(existing, generated) ||
        manifest.files[WRANGLER_FILE] === hash(existing)
      )
        removed.add(WRANGLER_FILE)
      else
        return yield* new OverlayConflict({
          file: WRANGLER_FILE,
          files: [WRANGLER_FILE],
          diff: unifiedDiff(WRANGLER_FILE, existing, generated ?? ""),
        })
    }

    // 3. transforms, against the current disk content of the seam files
    const active = scope.flatMap(({ manifest: m }) =>
      m.transforms.filter((t) => switchedOn(m.id, t.when)),
    )
    const wanted = new Set<string>()
    for (const t of active)
      for (const file of transformTargets(t)) {
        if (!safe(file))
          return yield* new GenerateError({
            reason: "unsafe-path",
            path: file,
            message: `transform file "${file}" is outside the project directory`,
          })
        wanted.add(file)
      }
    for (const rel of wanted) {
      const text = yield* read(rel)
      if (text !== undefined && !tree.has(rel)) tree.set(rel, text)
    }
    let current: ReadonlyMap<string, string> = tree
    const seams = new Set<string>()
    for (const t of active) {
      const prev = current
      current = yield* runTransform(prev, t)
      for (const [file, content] of current)
        if (prev.get(file) !== content) {
          seams.add(file)
          if (content !== disk.get(file)) out.set(file, content)
          else out.delete(file)
        }
    }
    const transformed = new Set<string>()
    for (const file of seams) {
      // seam files are re-edited by transforms on every add, never hash-checked
      delete hashes[file]
      if (out.has(file)) (written.has(file) ? written : transformed).add(file)
    }

    // 4. dependencies merged into the existing package.json files
    const used = new Set<string>()
    const packages = new Map<string, string>()
    for (const { manifest: m } of fresh)
      for (const key of ["dependencies", "devDependencies"] as const)
        for (const [pkgDir, names] of Object.entries(m[key])) {
          const target = pkgDir === "." ? "package.json" : `${pkgDir}/package.json`
          const text = packages.get(target) ?? tree.get(target) ?? (yield* read(target))
          if (text === undefined)
            return yield* new GenerateError({
              reason: "missing-package-json",
              path: target,
              message: `${m.id} adds dependencies to ${target}, which does not exist`,
            })
          const pkg = yield* Effect.try({
            try: () => JSON.parse(text) as Record<string, unknown>,
            catch: (e) =>
              new GenerateError({
                reason: "invalid-json",
                path: target,
                message: `${target} is not valid JSON: ${String(e)}`,
              }),
          })
          const existing = (pkg[key] as Record<string, string> | undefined) ?? {}
          const deps = { ...existing }
          // a Docker build context can't see the root catalog, so such a package pins exact versions
          const pkgPrefix = pkgDir === "." ? "" : `${pkgDir}/`
          const standalone =
            tree.has(`${pkgPrefix}Dockerfile`) ||
            (yield* read(`${pkgPrefix}Dockerfile`)) !== undefined
          for (const name of names) {
            if (name.startsWith("@repo/")) {
              if (!(name in deps)) deps[name] = "workspace:*"
              continue
            }
            if (versions[name] === undefined)
              return yield* new GenerateError({
                reason: "unpinned",
                package: name,
                message: `${m.id} uses "${name}", which has no entry in versions.ts`,
              })
            if (!standalone) used.add(name)
            if (!(name in deps)) deps[name] = standalone ? versions[name] : "catalog:"
          }
          if (Object.keys(deps).length === Object.keys(existing).length) continue
          // keep the user's order unless they were already sorted
          const keys = Object.keys(existing)
          const ordered = keys.every((k, i) => i === 0 || byName(keys[i - 1] as string, k) <= 0)
            ? Object.fromEntries(Object.entries(deps).toSorted(([a], [b]) => byName(a, b)))
            : deps
          const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  "
          packages.set(
            target,
            `${JSON.stringify({ ...pkg, [key]: ordered }, null, indent)}${text.endsWith("\n") ? "\n" : ""}`,
          )
        }
    // scripts of the new add-ons (they replace same-named ones, like generate does)
    const replacedScripts: string[] = []
    for (const { manifest: m } of fresh)
      for (const [pkgDir, scripts] of Object.entries(m.scripts ?? {})) {
        const target = pkgDir === "." ? "package.json" : `${pkgDir}/package.json`
        const text = packages.get(target) ?? tree.get(target) ?? (yield* read(target))
        if (text === undefined)
          return yield* new GenerateError({
            reason: "missing-package-json",
            path: target,
            message: `${m.id} adds scripts to ${target}, which does not exist`,
          })
        const pkg = JSON.parse(text) as Record<string, unknown>
        const existingScripts = (pkg.scripts as Record<string, string> | undefined) ?? {}
        for (const [name, cmd] of Object.entries(scripts))
          if (existingScripts[name] !== undefined && existingScripts[name] !== cmd)
            replacedScripts.push(`${target}: ${name}`)
        const merged = { ...existingScripts, ...scripts }
        const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  "
        const next = `${JSON.stringify({ ...pkg, scripts: merged }, null, indent)}${text.endsWith("\n") ? "\n" : ""}`
        if (next !== text) packages.set(target, next)
      }
    for (const [target, text] of packages) {
      out.set(target, text)
      written.add(target)
    }

    // 5. pnpm catalog, and the overrides that hold every Effect package at the project's `effect`
    // version (added to projects made before efforge wrote them)
    {
      const text = (yield* read("pnpm-workspace.yaml")) ?? "packages:\n  - apps/*\n  - packages/*\n"
      const doc = parseDocument(text)
      const catalog = {
        ...(doc.getIn(["catalog"]) as { toJSON(): Record<string, string> } | null)?.toJSON(),
      }
      const effect = catalog.effect ?? effectVersion
      // a new Effect package joins at the project's `effect` version, not at efforge's newest pin
      for (const name of used)
        catalog[name] ??= isEffectLockstep(name) ? effect : (versions[name] as string)
      if (used.size > 0)
        doc.setIn(
          ["catalog"],
          Object.fromEntries(Object.entries(catalog).toSorted(([a], [b]) => byName(a, b))),
        )
      for (const [name, version] of Object.entries(effectOverrides(effect)))
        if (!doc.hasIn(["overrides", name])) doc.setIn(["overrides", name], version)
      const next = doc.toString()
      if (next !== text) {
        out.set("pnpm-workspace.yaml", next)
        written.add("pnpm-workspace.yaml")
      }
    }

    // 6. env vars
    const envText = (yield* read(".env.example")) ?? ""
    const have = new Set(envText.split("\n").map((l) => l.split("=")[0]?.trim()))
    const groups: string[] = []
    const envVars: EnvVar[] = []
    const envFile = localEnvFile(stack)
    const local = out.get(envFile) ?? (yield* read(envFile))
    for (const { manifest: m } of scope) {
      const vars = m.envVars.filter((v) => switchedOn(m.id, v.when) && !have.has(v.name))
      for (const v of vars) {
        have.add(v.name)
        envVars.push({
          name: v.name,
          description: v.description,
          file: envFile,
          set: assigns(local, v.name),
        })
      }
      if (vars.length > 0)
        groups.push(`# ${m.title}\n${vars.map((v) => `${v.name}=${v.example}`).join("\n")}`)
    }
    if (groups.length > 0) {
      const base = envText === "" || envText.endsWith("\n") ? envText : `${envText}\n`
      out.set(".env.example", `${base}${base === "" ? "" : "\n"}${groups.join("\n\n")}\n`)
      written.add(".env.example")
    }

    // 7. efforge.jsonc
    if (newIds.length > 0) {
      out.set(
        "efforge.jsonc",
        renderManifest({
          ...(manifest.$schema === undefined ? {} : { $schema: manifest.$schema }),
          efforgeVersion: manifest.efforgeVersion,
          stack,
          command: toCommand(stack),
          files: Object.fromEntries(
            Object.entries({ ...manifest.files, ...hashes })
              .filter(([file]) => !seams.has(file) && !removed.has(file))
              .toSorted(([a], [b]) => byName(a, b)),
          ),
        }),
      )
      written.add("efforge.jsonc")
    }

    const result: AddResult = {
      stack,
      written: [...written].toSorted(),
      created: [...written].filter((f) => disk.has(f) && disk.get(f) === undefined).toSorted(),
      transformed: [...transformed].toSorted(),
      skipped: skipped.toSorted(),
      removed: [...removed].toSorted(),
      added: fresh.map(({ manifest: m }) =>
        m.docs === undefined
          ? { id: m.id, title: m.title }
          : { id: m.id, title: m.title, docs: m.docs },
      ),
      envVars,
      replacedScripts,
    }
    if (opts.dryRun) return result

    // all-or-nothing: only now touch the disk
    for (const rel of removed) yield* fs.remove(path.join(dir, rel), { force: true }).pipe(io(rel))
    for (const [rel, content] of out) {
      const abs = path.join(dir, rel)
      yield* fs.makeDirectory(path.dirname(abs), { recursive: true }).pipe(io(rel))
      yield* fs.writeFileString(abs, content).pipe(io(rel))
    }
    if ((out.size > 0 || removed.size > 0) && opts.install !== false) {
      yield* exec("pnpm", ["install"], dir)
      // add-ons may add or replace routes
      yield* generateRouteTree(dir)
    }
    return result
  })

// --- CLI -----------------------------------------------------------------------

/** `add` was given no ids: `available` are the add-ons the project doesn't have yet. */
export class NoAddonIds extends Schema.TaggedError<NoAddonIds>()("NoAddonIds", {
  available: Schema.Array(Schema.String),
}) {}

/** Add-on ids the project doesn't have yet, in `list` order. */
export const addable = (stack: StackConfig): string[] =>
  slots
    .filter((s) => s.options.length > 1)
    .flatMap((s) =>
      s.options
        .filter((o) => o.id !== "none")
        .filter((o) =>
          s.id === "extras" ? !stack.extras.includes(o.id as never) : stack[s.id] === "none",
        )
        .map((o) => `${s.id}/${o.id}`),
    )

/** The efforge project nearest to `dir`: a parent, or the one child that holds efforge.jsonc. */
const nearbyProject = (dir: string): string | undefined => {
  for (let d = dirname(dir); d !== dirname(d); d = dirname(d))
    if (existsSync(join(d, "efforge.jsonc"))) return d
  try {
    const children = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "efforge.jsonc")))
      .map((e) => join(dir, e.name))
    return children.length === 1 ? children[0] : undefined
  } catch {
    return undefined
  }
}

/** `--cwd` for `dir`, relative to where efforge runs. */
const cwdArg = (dir: string) => relative(process.cwd(), dir) || "."

/** What went wrong in `add` (or `list --cwd`), as the contract reports it. */
export const addFailure = (
  e: { readonly _tag: string; readonly message?: string } & Record<string, unknown>,
  args: ReadonlyArray<string>,
  projectDir: string = process.cwd(),
): Failure => {
  const run = commandLine
  const ids = positionals(args).slice(1)
  switch (e._tag) {
    case "NotAnEfforgeProject": {
      const dir = String(e.dir)
      const near = e.reason === "efforge.jsonc not found" ? nearbyProject(dir) : undefined
      return {
        code: "NotAnEfforgeProject",
        message: `${dir} is not an efforge project (${String(e.reason)}). Run this from the project root or pass --cwd.`,
        fix: near === undefined ? null : run(setFlag(args, "cwd", cwdArg(near))),
        details: {
          directory: dir,
          reason: String(e.reason),
          ...(near === undefined ? {} : { project: near }),
        },
      }
    }
    case "NoAddonIds": {
      const available = e.available as string[]
      return {
        code: "NoAddonIds",
        message: `Name the add-ons to add${available.length > 0 ? `: ${available.join(", ")}` : "; this project already has every add-on"}. For example: npx create-efforge add ${available[0] ?? "email"}.`,
        fix: run(["list", ...jsonOf(args), ...cwdOf(args)]),
        details: { available },
      }
    }
    case "UnknownAddon": {
      const suggestions = e.suggestions as string[]
      const at = ids.find(([, t]) => t === e.id)
      return {
        code: "UnknownAddon",
        message: String(e.message),
        fix:
          suggestions.length === 1 && at !== undefined
            ? run(replaceAt(args, at[0], suggestions[0] as string))
            : run(["list", ...jsonOf(args), ...cwdOf(args)]),
        details: { id: String(e.id), suggestions },
      }
    }
    case "RemoveNotSupported":
      return {
        code: "RemoveNotSupported",
        message: `Removing an add-on isn't supported yet ("${String(e.id)}").`,
        fix: null,
        details: { id: String(e.id) },
      }
    case "SlotAlreadySet":
      return {
        code: "SlotAlreadySet",
        message: `Can't add ${String(e.slot)}/${String(e.value)}: ${String(e.slot)} is already "${String(e.current)}", and swapping an existing choice isn't supported yet. Create a new project to use a different ${String(e.slot)}.`,
        fix: null,
        details: { slot: String(e.slot), current: String(e.current), value: String(e.value) },
      }
    case "IncompatibleStack": {
      const needs = (e.needs as string[] | undefined) ?? []
      const [first] = ids
      return {
        code: "IncompatibleStack",
        message: `Can't add ${String(e.slot)}/${String(e.value)}: ${typeof e.reason === "string" ? e.reason : "not compatible with the current stack."}`,
        fix:
          needs.length > 0 && first !== undefined ? run(insertAt(args, first[0], ...needs)) : null,
        details: {
          slot: String(e.slot),
          value: String(e.value),
          allowed: e.allowed as string[],
          needs,
          ...(typeof e.reason === "string" ? { reason: e.reason } : {}),
        },
      }
    }
    case "OverlayConflict": {
      const files = e.files as string[]
      return {
        code: "OverlayConflict",
        message: `You've edited ${files.join(", ")} since ${files.length === 1 ? "it was" : "they were"} generated. Nothing was written. Re-run with --overwrite to replace ${files.length === 1 ? "it" : "them"} (your edits are lost), or commit first and merge by hand.`,
        fix: run(setFlag(args, "overwrite")),
        details: { files, diff: String(e.diff) },
        more: String(e.diff),
      }
    }
    case "TransformAnchorMissing":
      return {
        code: "TransformAnchorMissing",
        message: `Couldn't find ${String(e.anchor)} in ${String(e.file)}. Nothing was written. Add this by hand, then re-run:\n${String(e.snippet)}`,
        fix: null,
        details: { file: String(e.file), anchor: String(e.anchor), snippet: String(e.snippet) },
      }
    case "CommandFailed": {
      const output = String(e.output).trim()
      const dir = projectDir
      return {
        code: "CommandFailed",
        message: `\`${String(e.command)}\` failed. The files were written; run it yourself.`,
        fix: inDir(relative(process.cwd(), dir), [String(e.command)]),
        details: { failed: String(e.command), output: output.split("\n").slice(-15).join("\n") },
        more: output,
      }
    }
    case "PnpmMissing":
      return {
        code: "PnpmMissing",
        message:
          "efforge projects use pnpm, and it isn't on your PATH. Install it (npm install --global pnpm, or https://pnpm.io/installation) and re-run, or pass --no-install.",
        fix: `npm install --global pnpm && ${run(args)}`,
      }
    default:
      return internal(e)
  }
}

const jsonOf = (args: ReadonlyArray<string>): string[] =>
  args.some((a) => a === "--json" || a.startsWith("--json=")) ? ["--json"] : []

/** `--cwd=<dir>` from `args`, to carry over into a suggested `list`. */
const cwdOf = (args: ReadonlyArray<string>): string[] => {
  const i = args.findIndex((t) => t === "--cwd" || t.startsWith("--cwd="))
  const t = args[i]
  if (t === undefined) return []
  if (t.includes("=")) return [t]
  const v = args[i + 1]
  return v === undefined ? [] : [`--cwd=${v}`]
}

export const addConfig = {
  ids: Argument.String("ids").pipe(
    Argument.withDescription("Add-ons to add: email, extras/email, ai/effect-ai-byok, ..."),
    Argument.atLeast(0),
  ),
  overwrite: Flag.Boolean("overwrite").pipe(
    Flag.withDescription("Replace generated files you have edited"),
    Flag.withDefault(false),
  ),
  dryRun: Flag.Boolean("dry-run").pipe(
    Flag.withDescription("Print what would change; write nothing"),
    Flag.withDefault(false),
  ),
  json: Flag.Boolean("json").pipe(
    Flag.withDescription("Print one JSON document on stdout, nothing else (docs/json.md)"),
    Flag.withDefault(false),
  ),
  cwd: Flag.String("cwd").pipe(
    Flag.withDescription("Project directory (default: current directory)"),
    Flag.withDefault("."),
  ),
  install: Flag.Boolean("install").pipe(
    Flag.withDescription("Run pnpm install afterwards (--no-install to skip)"),
    Flag.withDefault(true),
  ),
}

/** `a.b.c` -> numbers, for the "project is newer than this CLI" check. */
const newer = (a: string, b: string): boolean => {
  const pa = a.split(/[.-]/).map(Number)
  const pb = b.split(/[.-]/).map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

/** Word-wraps `text` to `width` columns. */
const wrap = (text: string, width: number): string[] => {
  const lines: string[] = []
  let line = ""
  for (const word of text.split(/\s+/)) {
    if (line !== "" && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else line = line === "" ? word : `${line} ${word}`
  }
  if (line !== "") lines.push(line)
  return lines
}

const list = (files: ReadonlyArray<string>, mark: string) => files.map((f) => `${mark} ${f}`)

export const addHandler = (input: {
  ids: ReadonlyArray<string>
  overwrite: boolean
  dryRun: boolean
  json: boolean
  cwd: string
  install: boolean
}) => {
  const dir = resolve(input.cwd)
  return Effect.gen(function* () {
    const path = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const live = yield* PromptIO
    // --json keeps stdout to the one JSON document: steps still run, silently, and warnings are
    // collected into the document
    const warnings: string[] = []
    const io: PromptIOShape = input.json
      ? {
          ...live,
          warn: (m) => Effect.sync(() => void warnings.push(m)),
          info: (m) => Effect.sync(() => void warnings.push(m)),
          step: (_label, eff) => eff,
          task: (_label, eff) => eff(() => {}),
        }
      : live
    if (!input.json && input.ids.length > 0)
      yield* io.intro(
        `${pc.bgCyan(pc.black(" efforge add "))}${pc.dim(`  ${input.ids.join(" ")}`)}`,
      )

    const manifest = yield* readManifest(dir)
    // a picker for people belongs here later; for now, say what there is to add
    if (input.ids.length === 0) return yield* new NoAddonIds({ available: addable(manifest.stack) })
    if (newer(manifest.efforgeVersion, efforgeVersion))
      yield* io.warn(
        `This project was made with efforge ${manifest.efforgeVersion}, newer than this CLI (${efforgeVersion}). Use npx create-efforge@latest add.`,
      )
    const opts = { overwrite: input.overwrite, install: false }
    // checked before anything is written: install and the route tree both need pnpm
    if (input.install && !input.dryRun && !(yield* has("pnpm"))) return yield* new PnpmMissing()
    // plan first (in memory): the dirty-tree warning only matters when something will change
    const plan = yield* addAddons(dir, input.ids, { ...opts, dryRun: true })
    const changes = plan.written.length + plan.transformed.length + plan.removed.length > 0
    if (changes && !input.dryRun) {
      const dirty = yield* exec("git", ["status", "--porcelain"], dir).pipe(
        Effect.map((out) => out.trim() !== ""),
        Effect.catchTag("CommandFailed", () => Effect.succeed(false)),
      )
      if (dirty)
        yield* io.warn(
          "You have uncommitted changes, so git diff will mix them with efforge's edits. Commit or stash first to review them on their own.",
        )
    }
    const result =
      input.dryRun || !changes ? plan : yield* addAddons(dir, input.ids, { ...opts, dryRun: false })
    // only when dependencies changed: package.json files or the catalog
    const depsChanged = result.written.some(
      (f) => f.endsWith("package.json") || f === "pnpm-workspace.yaml",
    )
    // a project created with --no-install has no node_modules yet, so no route-tree generator
    const installed = yield* fs
      .exists(path.join(dir, "node_modules"))
      .pipe(Effect.orElseSucceed(() => false))
    const installs = input.install && !input.dryRun && changes && depsChanged
    const finish = Effect.gen(function* () {
      if (!input.install || input.dryRun || !changes) return
      if (installs)
        yield* io.task("Installing dependencies (pnpm install)", (log) =>
          exec("pnpm", ["install"], dir, log),
        )
      // add-ons may add or replace routes; without an install, `pnpm typecheck` regenerates it later
      if (installs || installed) yield* io.step("Generating the route tree", generateRouteTree(dir))
    })
    // a new database needs its tables before the app (or sign-up) can use it
    const database = result.added.find((a) => a.id.startsWith("database/"))?.id.split("/")[1]
    const alchemy =
      manifest.stack.infra === "alchemy" || result.added.some((a) => a.id === "infra/alchemy")
    const steps: Step[] = [
      ...(changes && !installs && (depsChanged || !installed) ? [{ command: "pnpm install" }] : []),
      ...(database === "postgres"
        ? [
            { command: "docker compose up -d --wait", note: "local Postgres" },
            { command: "pnpm db:migrate" },
          ]
        : []),
      ...(database === "d1" && !alchemy ? [{ command: "pnpm db:migrate", note: "local D1" }] : []),
    ]
    if (result.removed.length > 0)
      yield* io.warn(
        `${input.dryRun ? "Would remove" : "Removed"} ${result.removed.join(", ")}: the new add-ons replace it.`,
      )
    if (result.replacedScripts.length > 0)
      yield* io.warn(
        `${input.dryRun ? "Would replace" : "Replaced"} existing package scripts:\n${result.replacedScripts.map((x) => `  ${x}`).join("\n")}`,
      )
    if (input.json) {
      yield* finish
      return yield* printSuccess({
        dryRun: input.dryRun,
        directory: dir,
        stack: result.stack,
        added: result.added,
        skipped: result.skipped,
        created: result.created,
        changed: [
          ...result.written.filter((f) => !result.created.includes(f)),
          ...result.transformed,
        ].toSorted(),
        removed: result.removed,
        replacedScripts: result.replacedScripts,
        installed: installs,
        env: result.envVars,
        nextSteps: steps.map((s) => Object.assign({}, s, { cwd: dir })),
        warnings,
      })
    }

    const changed = result.written.length + result.transformed.length + result.removed.length > 0
    if (!changed) {
      yield* io.info(`Already there: ${result.skipped.join(", ")}`)
      return yield* io.outro("Nothing to do.")
    }
    yield* io.note(
      [
        ...list(result.created, pc.green("+")),
        ...list(
          [
            ...result.written.filter((f) => !result.created.includes(f)),
            ...result.transformed,
          ].toSorted(),
          pc.yellow("~"),
        ),
        ...list(result.removed, pc.red("-")),
      ].join("\n"),
      `${input.dryRun ? "Would change" : "Changed"}: ${result.added.map((a) => a.title).join(", ") || "stack"}`,
    )
    if (input.dryRun) return yield* io.outro(pc.dim("dry run: nothing written"))

    yield* finish
    const width = Math.max(0, ...result.envVars.map((x) => x.name.length))
    const room = Math.max(30, (process.stdout.columns || 80) - 14)
    const lines = [
      ...steps.map((s) => `  ${pc.cyan(s.command)}`),
      ...(result.envVars.length > 0
        ? [
            `${steps.length > 0 ? "\n" : ""}${pc.bold("New env vars")} ${pc.dim("(in .env.example; local values in .dev.vars)")}`,
            // full descriptions, wrapped under the name: the hint at the end is often the useful part
            ...result.envVars.map(
              (v) =>
                `  ${v.name.padEnd(width)}\n${wrap(v.description, room)
                  .map((l) => `    ${pc.dim(l)}`)
                  .join("\n")}`,
            ),
          ]
        : []),
      ...result.added
        .filter((a) => a.docs !== undefined)
        .map((a) => `${a.title}: ${pc.dim(a.docs as string)}`),
    ]
    if (lines.length > 0) yield* io.note(lines.join("\n"), "Next steps")
    yield* io.outro(`${pc.green("Done.")} ${pc.dim("Review the changes with")} git diff`)
  }).pipe(
    Effect.catch((e) =>
      Effect.gen(function* () {
        const args = yield* Invocation
        yield* report(input.json, addFailure(e as never, args, dir))
      }),
    ),
  )
}

export const addCommand = Command.make("add", addConfig, addHandler).pipe(
  Command.withDescription("Add an add-on to an existing efforge project"),
  Command.withExamples([
    { command: "npx create-efforge add email", description: "Add the email add-on" },
    {
      command: "npx create-efforge add ai/effect-ai-byok extras/storage --dry-run",
      description: "Show what would change; write nothing",
    },
    {
      command: "npx create-efforge add database/d1 orm/effect-sql auth/better-auth",
      description: "Add a database, an ORM and auth together",
    },
  ]),
)
