import { Console, Effect, FileSystem, Path, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import type { ChildProcessSpawner } from "effect/process"
import { type ParseError, parse } from "jsonc-parser"
import pc from "picocolors"
import { parseDocument } from "yaml"
import { type AddonLoadError, addonIdsFor, loadAddons } from "../addon.ts"
import { unifiedDiff } from "../diff.ts"
import { type CommandFailed, exec } from "../exec.ts"
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
import { PromptIO } from "../prompts/navigable.ts"
import { efforgeVersion, versions } from "../versions.ts"
import { TemplatesDir } from "./create.ts"

export class NotAnEfforgeProject extends Schema.TaggedError<NotAnEfforgeProject>()(
  "NotAnEfforgeProject",
  { dir: Schema.String, reason: Schema.String },
) {}

/** A target file that exists, differs from what efforge generated, and `--overwrite` wasn't given. */
export class OverlayConflict extends Schema.TaggedError<OverlayConflict>()("OverlayConflict", {
  file: Schema.String,
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
  /** Env vars this run added to `.env.example`. */
  readonly envVars: ReadonlyArray<{ readonly name: string; readonly description: string }>
  /** `<package.json>: <script>` entries whose existing command an add-on replaced. */
  readonly replacedScripts: string[]
}

export type AddError =
  | NotAnEfforgeProject
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
) => new IncompatibleStack({ slot, value, allowed, reason })

const allIds = slots.flatMap((s) =>
  s.options.filter((o) => o.id !== "none").map((o) => `${s.id}/${o.id}`),
)

/** Edit distance, for "did you mean". */
const distance = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] as number
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j] as number
      row[j] = Math.min(
        (row[j] as number) + 1,
        (row[j - 1] as number) + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      prev = tmp
    }
  }
  return row[b.length] as number
}

const suggest = (id: string): string | undefined => {
  const best = allIds
    .flatMap((full) => [full, full.split("/")[1] as string])
    .map((c) => [c, distance(id, c)] as const)
    .toSorted((a, b) => a[1] - b[1])[0]
  return best !== undefined && best[1] <= 3 ? best[0] : undefined
}

const isNewPackageJson = (target: string) => target.endsWith("/package.json")

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** `email`, `extras/email`, `ai/effect-ai-byok`, `ai=effect-ai-byok` -> slot + option. */
const parseId = (
  raw: string,
): Effect.Effect<{ slot: SlotDef; option: string }, IncompatibleStack> => {
  const id = raw.trim().toLowerCase()
  const [slotPart, option = ""] = id.includes("=")
    ? id.split("=", 2)
    : id.includes("/")
      ? id.split("/", 2)
      : [undefined, id]
  const unknown = (why: string) => Effect.fail(incompatible("extras", id, allIds, why))
  if (option === "none") return unknown("Removing an add-on isn't supported in v0.1.")
  const candidates = slots.filter(
    (s) => (slotPart === undefined || s.id === slotPart) && s.options.some((o) => o.id === option),
  )
  const [first] = candidates
  if (first === undefined) {
    const guess = suggest(id)
    return unknown(
      `"${raw}" is not an add-on.${guess === undefined ? "" : ` Did you mean ${guess}?`} Run efforge list to see them all.`,
    )
  }
  if (candidates.length > 1)
    return unknown(
      `"${id}" is ambiguous; write it as ${candidates.map((s) => `${s.id}/${id}`).join(" or ")}.`,
    )
  return Effect.succeed({ slot: first, option })
}

/** Applies `ids` to `stack`. Single-select slots may only go from `none` to a value. */
const applyIds = (
  stack: StackConfig,
  ids: ReadonlyArray<string>,
): Effect.Effect<{ stack: StackConfig; skipped: string[] }, IncompatibleStack> =>
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
      else
        return yield* incompatible(
          slot.id,
          option,
          [current],
          `${slot.id} is already "${current}"; swapping an existing choice isn't supported in v0.1. Create a new project to use a different ${slot.id}.`,
        )
    }
    const valid = yield* validate(next).pipe(
      Effect.mapError((e) => {
        // the stack rules hold across slots: say which ids to add together
        const typed = ids.join(" ")
        const hint =
          next.database === "none" && (e.slot === "orm" || e.slot === "auth")
            ? ` Add a database and an ORM in the same command: efforge add database/d1 orm/effect-sql ${typed}`
            : e.slot === "orm" && next.orm === "none"
              ? ` Add an ORM with it: efforge add ${typed} orm/drizzle (or orm/effect-sql)`
              : ""
        return hint === ""
          ? e
          : incompatible(
              e.slot,
              e.value,
              [...e.allowed],
              `${e.reason ?? "not compatible with the current stack"}.${hint}`,
            )
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
        existing === generated ||
        manifest.files[WRANGLER_FILE] === hash(existing)
      )
        removed.add(WRANGLER_FILE)
      else
        return yield* new OverlayConflict({
          file: WRANGLER_FILE,
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

    // 5. pnpm catalog
    if (used.size > 0) {
      const text = (yield* read("pnpm-workspace.yaml")) ?? "packages:\n  - apps/*\n  - packages/*\n"
      const doc = parseDocument(text)
      const catalog = {
        ...(doc.getIn(["catalog"]) as { toJSON(): Record<string, string> } | null)?.toJSON(),
      }
      for (const name of used) catalog[name] ??= versions[name] as string
      doc.setIn(
        ["catalog"],
        Object.fromEntries(Object.entries(catalog).toSorted(([a], [b]) => byName(a, b))),
      )
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
    const envVars: Array<{ name: string; description: string }> = []
    for (const { manifest: m } of scope) {
      const vars = m.envVars.filter((v) => switchedOn(m.id, v.when) && !have.has(v.name))
      for (const v of vars) {
        have.add(v.name)
        envVars.push({ name: v.name, description: v.description })
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

const describe = (
  e: { readonly _tag: string; readonly message?: string } & Record<string, unknown>,
): string => {
  switch (e._tag) {
    case "NotAnEfforgeProject":
      return `${String(e.dir)} is not an efforge project (${String(e.reason)}). Run this from the project root or pass --cwd.`
    case "IncompatibleStack":
      return typeof e.reason === "string" && e.reason.includes("efforge list")
        ? e.reason
        : `Can't add ${String(e.slot)}/${String(e.value)}: ${typeof e.reason === "string" ? e.reason : "not compatible with the current stack."}`
    case "OverlayConflict":
      return `You've edited ${String(e.file)} since it was generated. Nothing was written. Re-run with --overwrite to replace it.\n\n${String(e.diff)}`
    case "TransformAnchorMissing":
      return `Couldn't find ${String(e.anchor)} in ${String(e.file)}. Nothing was written. Add this by hand, then re-run:\n${String(e.snippet)}`
    case "CommandFailed":
      return `\`${String(e.command)}\` failed. The files were written; run it yourself.\n${String(e.output).trim()}`
    default:
      return e.message ?? e._tag
  }
}

export const addConfig = {
  ids: Argument.String("ids").pipe(
    Argument.withDescription("Add-ons to add: email, extras/email, ai/effect-ai-byok, ..."),
    Argument.atLeast(1),
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
    Flag.withDescription("Print the result as JSON on stdout"),
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

const list = (files: ReadonlyArray<string>, mark: string) => files.map((f) => `${mark} ${f}`)

export const addHandler = (input: {
  ids: ReadonlyArray<string>
  overwrite: boolean
  dryRun: boolean
  json: boolean
  cwd: string
  install: boolean
}) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const live = yield* PromptIO
    const dir = path.resolve(input.cwd)
    const io = input.json
      ? { ...live, step: <A, E, R>(_: string, eff: Effect.Effect<A, E, R>) => eff }
      : live
    if (!input.json)
      yield* io.intro(
        `${pc.bgCyan(pc.black(" efforge add "))}${pc.dim(`  ${input.ids.join(" ")}`)}`,
      )

    const manifest = yield* readManifest(dir)
    if (!input.json && newer(manifest.efforgeVersion, efforgeVersion))
      yield* io.warn(
        `This project was made with efforge ${manifest.efforgeVersion}, newer than this CLI (${efforgeVersion}). Use npx create-efforge@latest add.`,
      )
    const opts = { overwrite: input.overwrite, install: false }
    // plan first (in memory): the dirty-tree warning only matters when something will change
    const plan = yield* addAddons(dir, input.ids, { ...opts, dryRun: true })
    const changes = plan.written.length + plan.transformed.length + plan.removed.length > 0
    if (changes && !input.dryRun && !input.json) {
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
    if (input.json)
      return yield* Console.log(JSON.stringify({ dryRun: input.dryRun, ...result }, null, 2))

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
    if (result.removed.length > 0)
      yield* io.warn(
        `${input.dryRun ? "Would remove" : "Removed"} ${result.removed.join(", ")}: the new add-ons replace it.`,
      )
    if (result.replacedScripts.length > 0)
      yield* io.warn(
        `${input.dryRun ? "Would replace" : "Replaced"} existing package scripts: ${result.replacedScripts.join(", ")}`,
      )
    if (input.dryRun) return yield* io.outro(pc.dim("dry run: nothing written"))

    // only when dependencies changed: package.json files or the catalog
    const depsChanged = result.written.some(
      (f) => f.endsWith("package.json") || f === "pnpm-workspace.yaml",
    )
    if (input.install) {
      if (depsChanged)
        yield* io.task("Installing dependencies (pnpm install)", (log) =>
          exec("pnpm", ["install"], dir, log),
        )
      // add-ons may add or replace routes
      yield* io.step("Generating the route tree", generateRouteTree(dir))
    }
    const steps = [
      ...(input.install || !depsChanged ? [] : [`  ${pc.cyan("pnpm install")}`]),
      ...(result.envVars.length > 0
        ? [
            `${pc.bold("New env vars")} ${pc.dim("(in .env.example; local values in .dev.vars)")}`,
            ...result.envVars.map((v) => {
              const width = Math.max(...result.envVars.map((x) => x.name.length))
              const room = Math.max(20, (process.stdout.columns || 80) - width - 14)
              const brief = v.description.split(/;\s/)[0] ?? v.description
              return `  ${v.name.padEnd(width)}  ${pc.dim(brief.length > room ? `${brief.slice(0, room - 1)}…` : brief)}`
            }),
          ]
        : []),
      ...result.added
        .filter((a) => a.docs !== undefined)
        .map((a) => `${a.title}: ${pc.dim(a.docs as string)}`),
    ]
    if (steps.length > 0) yield* io.note(steps.join("\n"), "Next steps")
    yield* io.outro(`${pc.green("Done.")} ${pc.dim("Review the changes with")} git diff`)
  }).pipe(
    Effect.catch((e) =>
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          process.exitCode = 1
        })
        if (input.json)
          return yield* Console.log(
            JSON.stringify({ error: { code: e._tag, message: describe(e as never) } }, null, 2),
          )
        yield* Console.error(pc.red(describe(e as never)))
      }),
    ),
  )

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
