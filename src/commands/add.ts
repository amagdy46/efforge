import { relative, resolve } from "node:path"
import { Effect, Exit, FileSystem, Path, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import type { ChildProcessSpawner } from "effect/process"
import { type ParseError, parse } from "jsonc-parser"
import pc from "picocolors"
import { parseDocument } from "yaml"
import { type AddonLoadError, type AddonManifest, addonIdsFor, loadAddons } from "../addon.ts"
import { cardTransforms, presentCardTransforms, REGISTRY_FILE } from "../cards.ts"
import { type Failure, internal, Invocation, printSuccess, report } from "../contract.ts"
import { unifiedDiff } from "../diff.ts"
import { type CommandFailed, exec, has, INSTALL, INSTALL_ARGS } from "../exec.ts"
import {
  addonSuggestions,
  alternative,
  finish,
  fix,
  type Intent,
  nearbyProject,
  withFlag,
} from "../fix.ts"
import { GenerateError, generate, isComputed, matches } from "../generate.ts"
import { installOwed } from "../installed.ts"
import { introLine } from "../intro.ts"
import { EfforgeManifest, hash, renderManifest } from "../manifest.ts"
import { applyProjectName } from "../projectName.ts"
import { generateRouteTree } from "../routeTree.ts"
import { IncompatibleStack, validate } from "../rules.ts"
import { type SlotDef, slots } from "../slots.ts"
import { type StackConfig, toCommand } from "../stack.ts"
import { WRANGLER_FILE } from "../transforms/addWranglerBinding.ts"
import {
  runTransform,
  unguardedServerFns,
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
  pnpmVersion,
  pnpmWildcardOverrides,
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
  /** The root `packageManager`, when this run raised it so pnpm honours the Effect overrides. */
  readonly packageManager: { readonly from: string; readonly to: string } | null
  /** Things left for you to do by hand, one line each. */
  readonly notes: string[]
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

const allIds = slots.flatMap((s) =>
  s.options.filter((o) => o.id !== "none").map((o) => `${s.id}/${o.id}`),
)

const combinations = <A>(xs: ReadonlyArray<A>, k: number): A[][] =>
  k === 0
    ? [[]]
    : xs.flatMap((x, i) => combinations(xs.slice(i + 1), k - 1).map((rest) => [x].concat(rest)))

const product = <A>(lists: ReadonlyArray<ReadonlyArray<A>>): A[][] =>
  lists.reduce<A[][]>((acc, list) => acc.flatMap((xs) => list.map((x) => [...xs, x])), [[]])

/**
 * The smallest sets of ids that make `stack` valid when added with the caller's: each fills a
 * slot that is `none` and that the caller didn't name. Every set found is one way out; choosing
 * between them (D1 or Postgres, Drizzle or Effect SQL) is the caller's, since a slot can't be
 * swapped later.
 */
const waysOut = (stack: StackConfig, named: ReadonlySet<string>): string[][] => {
  const open = slots.filter(
    (s) => !s.multi && s.options.length > 1 && stack[s.id] === "none" && !named.has(s.id),
  )
  for (let k = 1; k <= 2; k++) {
    const found: string[][] = []
    for (const combo of combinations(open, k))
      for (const choice of product(
        combo.map((s) => s.options.filter((o) => o.id !== "none").map((o) => [s.id, o.id])),
      )) {
        const next = { ...stack, ...Object.fromEntries(choice) } as StackConfig
        if (Exit.isSuccess(Effect.runSyncExit(validate(next))))
          found.push(choice.map(([slot, option]) => `${slot}/${option}`))
      }
    if (found.length > 0) return found
  }
  return []
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
    const suggestions = addonSuggestions(id)
    return Effect.fail(
      new UnknownAddon({
        id: raw,
        suggestions,
        message: `"${raw}" is not an add-on.${suggestions.length === 0 ? "" : ` Did you mean ${suggestions.join(" or ")}?`}`,
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
    const named = new Set<string>()
    for (const id of ids) {
      const { slot, option } = yield* parseId(id)
      named.add(slot.id)
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
        // the stack rules hold across slots: say which ids could be added together
        const ways = waysOut(next, named)
        const reason =
          next.database === "none" && (e.slot === "orm" || e.slot === "auth")
            ? `${e.slot === "auth" ? "auth" : "an ORM"} needs a database, and this project has none. Add one in the same command (alternatives lists the ways)`
            : e.slot === "orm" && next.orm === "none"
              ? "a database needs an ORM. Add one in the same command (alternatives lists the ways)"
              : e.reason
        return new IncompatibleStack({
          slot: e.slot,
          value: e.value,
          allowed: [...e.allowed],
          ...(reason === undefined ? {} : { reason }),
          ways,
        })
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
    const info = yield* fs.stat(dir).pipe(Effect.orElseSucceed(() => undefined))
    if (info === undefined) return yield* fail("the directory does not exist")
    if (info.type !== "Directory") return yield* fail("not a directory")
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

    // a project made before capability cards (or whose dashboard was deleted) has no registry: its
    // add-ons come without their card, and the card's transforms are skipped with it
    const hasRegistry = (yield* read(REGISTRY_FILE)) !== undefined
    const notes: string[] = []
    const cardsSkipped: string[] = []
    const cardFiles = (m: AddonManifest) => {
      const files = (m.card?.files ?? []).filter((f) => switchedOn(m.id, f.when))
      if (files.length > 0 && !hasRegistry) cardsSkipped.push(m.title)
      return hasRegistry ? files : []
    }

    // 2. overlays: write if absent, replace if still what efforge generated, else conflict
    const overlays = new Map<string, string>()
    for (const { manifest: m, dir: addonDir } of scope)
      for (const f of [...m.files, ...cardFiles(m)]) {
        if (!switchedOn(m.id, f.when)) continue
        // package.json files are merged, not replaced: only a new workspace package's is created
        if (isComputed(f.target) && !(isNewPackageJson(f.target) && !(yield* read(f.target))))
          continue
        // a base file the add-on brings only to a project without it (one made before efforge had it)
        if (
          f.ifAbsent === true &&
          (overlays.has(f.target) || (yield* read(f.target)) !== undefined)
        )
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
    if (cardsSkipped.length > 0)
      notes.push(
        `No dashboard card for ${cardsSkipped.join(", ")}: this project has no ${REGISTRY_FILE} (made before efforge 0.3, or its dashboard was removed). The add-on works without it; there is nothing to do.`,
      )
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

    // 3. transforms, against the current disk content of the seam files. A card's transforms
    // apply where its files are: written by this run, or already on disk
    const present = new Set<string>(tree.keys())
    for (const { manifest: m } of scope)
      for (const file of [
        ...(m.card?.files ?? []).map((f) => f.target),
        ...cardTransforms(m).flatMap(transformTargets),
      ])
        if (!present.has(file) && safe(file) && (yield* read(file)) !== undefined) present.add(file)
    const active = scope.flatMap(({ manifest: m }) =>
      [...m.transforms, ...presentCardTransforms(m, (file) => present.has(file))].filter((t) =>
        switchedOn(m.id, t.when),
      ),
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
      // a transform with `ifMissing` is a hardening of a file the user may have from an older
      // efforge: without its anchor, the add goes on and says what to change by hand
      const ifMissing = t.args.ifMissing
      if (ifMissing === undefined) current = yield* runTransform(prev, t)
      else {
        const ran = yield* runTransform(prev, t).pipe(
          Effect.catchTag("TransformAnchorMissing", () => Effect.succeed(undefined)),
        )
        if (ran === undefined) {
          notes.push(ifMissing)
          continue
        }
        current = ran
      }
      for (const [file, content] of current)
        if (prev.get(file) !== content) {
          seams.add(file)
          if (content !== disk.get(file)) out.set(file, content)
          else out.delete(file)
        }
    }
    // a server function the guard could not reach (its `.middleware(...)` is not a written-out
    // list) is named, with the fix; the project's own lint rule fails on it until then
    for (const t of active) {
      if (t.name !== "addServerFnMiddleware" || t.args.file === undefined) continue
      const text = current.get(t.args.file)
      if (text === undefined) continue
      const middleware = t.args.middleware ?? "requireSession"
      for (const fn of unguardedServerFns(t.args.file, text, middleware))
        notes.push(
          `${fn} in ${t.args.file} is not guarded: its .middleware(...) is not a list efforge can add to. Put ${middleware} first in it, as .middleware([${middleware}, ...]), and import it from "${t.args.from ?? "./require-session"}". Until then it answers signed-out requests, and pnpm check fails (efforge/server-fn-session).`,
        )
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
        // an unscoped `effect` key (written by hand) already covers the scoped one
        if (
          !doc.hasIn(["overrides", name]) &&
          !(name.startsWith("effect@") && doc.hasIn(["overrides", "effect"]))
        )
          doc.setIn(["overrides", name], version)
      const next = doc.toString()
      if (next !== text) {
        out.set("pnpm-workspace.yaml", next)
        written.add("pnpm-workspace.yaml")
      }
    }

    // 5b. pnpm before 12.17 accepts the wildcard overrides and ignores them, which leaves a 0.2.0
    // project on mismatched Effect packages: raise `packageManager` to the generated pin, never lower it
    let packageManager: AddResult["packageManager"] = null
    {
      const text = out.get("package.json") ?? (yield* read("package.json"))
      let pkg: Record<string, unknown> | undefined
      try {
        pkg = text === undefined ? undefined : (JSON.parse(text) as Record<string, unknown>)
      } catch {} // not JSON: leave it alone (step 4 reports it when an add-on needs it)
      const from = typeof pkg?.packageManager === "string" ? pkg.packageManager : undefined
      const pinned = from === undefined ? undefined : /^pnpm@(\d+\.\d+\.\d+)/.exec(from)?.[1]
      if (text !== undefined && pinned !== undefined && newer(pnpmWildcardOverrides, pinned)) {
        const to = `pnpm@${pnpmVersion}`
        const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  "
        out.set(
          "package.json",
          `${JSON.stringify({ ...pkg, packageManager: to }, null, indent)}${text.endsWith("\n") ? "\n" : ""}`,
        )
        written.add("package.json")
        packageManager = { from: from as string, to }
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
      packageManager,
      notes,
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
      yield* exec("pnpm", [...INSTALL_ARGS], dir)
      // add-ons may add or replace routes
      yield* generateRouteTree(dir)
    }
    return result
  })

// --- CLI -----------------------------------------------------------------------

/** `add` wrote its files, then the install (or route tree) failed: `partial` is what it did. */
export class AddIncomplete extends Schema.TaggedError<AddIncomplete>()("AddIncomplete", {
  command: Schema.String,
  output: Schema.String,
  partial: Schema.Unknown,
}) {}

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

/** `--cwd` for `dir`, relative to where efforge runs. */
const cwdArg = (dir: string) => relative(process.cwd(), dir) || "."

/** `args` as a `list` of the same project, with the same --json. */
const asList = (i: Intent): Intent => ({
  verb: "list",
  word: "list",
  operands: [],
  flags: i.flags.filter((f) => f.name === "json" || f.name === "cwd"),
})

/** The add-on slots `ways` fill, each with the ids that can fill it. */
const needsOf = (ways: ReadonlyArray<ReadonlyArray<string>>) => {
  const bySlot = new Map<string, string[]>()
  for (const id of ways.flat()) {
    const slot = id.split("/")[0] as string
    const options = bySlot.get(slot) ?? []
    if (!options.includes(id)) options.push(id)
    bySlot.set(slot, options)
  }
  return [...bySlot].map(([slot, options]) => ({ slot, options }))
}

/** What went wrong in `add` (or `list --cwd`), as the contract reports it. */
export const addFailure = (
  e: { readonly _tag: string; readonly message?: string } & Record<string, unknown>,
  args: ReadonlyArray<string>,
  projectDir: string = process.cwd(),
): Failure => {
  const seeList = () => {
    const command = alternative(args, asList)
    return command === null ? "" : ` See which ones this project can add: ${command}`
  }
  switch (e._tag) {
    case "NotAnEfforgeProject": {
      const dir = String(e.dir)
      const near =
        e.reason === "efforge.jsonc not found" || e.reason === "not a directory"
          ? nearbyProject(dir)
          : undefined
      return {
        code: "NotAnEfforgeProject",
        message: `${dir} is not an efforge project (${String(e.reason)}). Run this from the project root or pass --cwd.`,
        fix:
          near === undefined
            ? null
            : fix(args, (i) => withFlag(i, "cwd", cwdArg(near)), { cwd: true }),
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
        message: `Name the add-ons to add${available.length > 0 ? `: ${available.join(", ")}` : "; this project already has every add-on"}.`,
        fix: fix(args, asList, { list: true }),
        details: { available },
      }
    }
    case "UnknownAddon": {
      const suggestions = e.suggestions as string[]
      const [only] = suggestions
      return {
        code: "UnknownAddon",
        message: `${String(e.message)}${seeList()}`,
        // only a clear typo becomes a command; anything else is the caller's choice to make
        fix:
          suggestions.length === 1 && only !== undefined
            ? fix(args, (i) => ({
                ...i,
                operands: i.operands.map((t) => (t === e.id ? only : t)),
              }))
            : null,
        details: { id: String(e.id), suggestions, addons: allIds },
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
      // every way out picks a database or an ORM for good (a slot can't be swapped later), so
      // the caller picks: no fix, the ways as complete commands
      const ways = (e.ways as string[][] | undefined) ?? []
      const alternatives = ways.flatMap((w) => {
        const command = alternative(args, (i) => ({ ...i, operands: [...w, ...i.operands] }))
        return command === null ? [] : [{ command, description: `Add ${w.join(" and ")} with it` }]
      })
      return {
        code: "IncompatibleStack",
        message: `Can't add ${String(e.slot)}/${String(e.value)}: ${typeof e.reason === "string" ? `${e.reason}.` : "not compatible with the current stack."}`,
        fix: null,
        details: {
          slot: String(e.slot),
          value: String(e.value),
          allowed: e.allowed as string[],
          needs: needsOf(ways),
          alternatives,
          ...(typeof e.reason === "string" ? { reason: e.reason } : {}),
        },
        more: alternatives.map((a) => `  ${a.command}  # ${a.description}`).join("\n"),
      }
    }
    case "OverlayConflict": {
      const files = e.files as string[]
      return {
        code: "OverlayConflict",
        message: `You've edited ${files.join(", ")} since ${files.length === 1 ? "it was" : "they were"} generated. Nothing was written. Re-run with --overwrite to replace ${files.length === 1 ? "it" : "them"} (your edits are lost), or commit first and merge by hand.`,
        fix: fix(args, (i) => withFlag(i, "overwrite", true), { overwrite: true }),
        details: { files, diff: String(e.diff) },
        more: String(e.diff),
      }
    }
    case "TransformAnchorMissing":
      return {
        code: "TransformAnchorMissing",
        message: `Couldn't find ${String(e.anchor)} in ${String(e.file)}. Nothing was written. Add the snippet by hand, then re-run.`,
        fix: null,
        details: { file: String(e.file), anchor: String(e.anchor), snippet: String(e.snippet) },
        more: String(e.snippet),
      }
    case "AddIncomplete": {
      const output = String(e.output).trim()
      return {
        code: "CommandFailed",
        message: `\`${String(e.command)}\` failed. The files were written; run it yourself, then the rest of nextSteps.`,
        fix: finish(args, projectDir, [String(e.command)]),
        details: {
          failed: String(e.command),
          output: output.split("\n").slice(-15).join("\n"),
          ...(e.partial as object),
        },
        more: output,
      }
    }
    case "CommandFailed": {
      const output = String(e.output).trim()
      return {
        code: "CommandFailed",
        message: `\`${String(e.command)}\` failed. The files were written; run it yourself.`,
        fix: finish(args, projectDir, [String(e.command)]),
        details: { failed: String(e.command), output: output.split("\n").slice(-15).join("\n") },
        more: output,
      }
    }
    case "PnpmMissing": {
      const again = fix(args, (i) => i, { again: true })
      return {
        code: "PnpmMissing",
        message:
          "efforge projects use pnpm, and it isn't on your PATH. Install it (npm install --global pnpm, or https://pnpm.io/installation) and re-run, or pass --no-install.",
        fix: again === null ? null : `npm install --global pnpm && ${again}`,
      }
    }
    default:
      return internal(e)
  }
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
    Flag.withDescription(
      "Print one JSON document on stdout, nothing else (https://github.com/amagdy46/efforge/blob/main/docs/json.md)",
    ),
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
  // how far the run got, for the document an interrupted --json run still prints
  const progress: {
    phase: "planning" | "writing" | "written"
    pending: string[]
    partial: object | undefined
  } = { phase: "planning", pending: [], partial: undefined }
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
      yield* io.intro(introLine(`add ${input.ids.join(" ")}`))

    const manifest = yield* readManifest(dir)
    // a picker for people belongs here later; for now, say what there is to add
    if (input.ids.length === 0) return yield* new NoAddonIds({ available: addable(manifest.stack) })
    if (newer(manifest.efforgeVersion, efforgeVersion))
      yield* io.warn(
        `This project was made with efforge ${manifest.efforgeVersion}, newer than this CLI (${efforgeVersion}). Use npx -y create-efforge@latest add.`,
      )
    // dependencies the package.json files declare but aren't installed (an earlier install
    // failed, was stopped or skipped): this run owes the install
    const owed = installOwed(dir)
    if (owed)
      yield* io.warn(
        `The dependencies in package.json aren't all installed: an earlier install didn't finish. ${input.install && !input.dryRun ? "Running it now." : `Run ${INSTALL}.`}`,
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
    if (!input.dryRun && changes) progress.phase = "writing"
    const result =
      input.dryRun || !changes ? plan : yield* addAddons(dir, input.ids, { ...opts, dryRun: false })
    if (progress.phase === "writing") progress.phase = "written"
    // only when dependencies changed: package.json files or the catalog
    const depsChanged = result.written.some(
      (f) => f.endsWith("package.json") || f === "pnpm-workspace.yaml",
    )
    // a project created with --no-install has no node_modules yet, so no route-tree generator
    const installed = yield* fs
      .exists(path.join(dir, "node_modules", ".modules.yaml"))
      .pipe(Effect.orElseSucceed(() => false))
    const installs = input.install && !input.dryRun && ((changes && depsChanged) || owed)
    // a new database needs its tables before the app (or sign-up) can use it; when the last
    // install never finished, neither did the steps after it, so count the ids already there too
    const touched = [...result.added.map((a) => a.id), ...(owed ? result.skipped : [])]
    const database = touched.find((id) => id.startsWith("database/"))?.split("/")[1]
    const alchemy = manifest.stack.infra === "alchemy" || touched.includes("infra/alchemy")
    const afterInstall: Step[] = [
      ...(database === "postgres"
        ? [
            { command: "docker compose up -d --wait", note: "local Postgres" },
            { command: "pnpm db:migrate" },
          ]
        : []),
      ...(database === "d1" && !alchemy ? [{ command: "pnpm db:migrate", note: "local D1" }] : []),
    ]
    const steps: Step[] = [
      ...(!installs && (owed || !installed || (changes && depsChanged))
        ? [{ command: INSTALL }]
        : []),
      ...afterInstall,
    ]
    const changedFiles = [
      ...result.written.filter((f) => !result.created.includes(f)),
      ...result.transformed,
    ].toSorted()
    /** What a success would report about the files, for the documents of a run that stopped. */
    const partial = (next: ReadonlyArray<Step>) => ({
      directory: dir,
      stack: result.stack,
      added: result.added,
      skipped: result.skipped,
      created: result.created,
      changed: changedFiles,
      removed: result.removed,
      replacedScripts: result.replacedScripts,
      packageManager: result.packageManager,
      notes: result.notes,
      env: result.envVars,
      nextSteps: [...next, ...afterInstall].map((x) => Object.assign({}, x, { cwd: dir })),
      warnings,
    })
    if (installs) progress.pending = [INSTALL]
    progress.partial = partial(progress.pending.map((command) => ({ command })))
    const complete = Effect.gen(function* () {
      if (!input.install || input.dryRun || (!changes && !installs)) return
      if (installs) {
        yield* io.task("Installing dependencies (pnpm install)", (log) =>
          exec("pnpm", [...INSTALL_ARGS], dir, log),
        )
        progress.pending = []
        progress.partial = partial([])
      }
      // add-ons may add or replace routes; without an install, `pnpm typecheck` regenerates it later
      if (installs || installed) yield* io.step("Generating the route tree", generateRouteTree(dir))
    }).pipe(
      // the files are written: say everything a success would have, starting with the failed command
      Effect.catchTag("CommandFailed", (e) =>
        Effect.fail(
          new AddIncomplete({
            command: e.command,
            output: e.output,
            partial: partial([{ command: e.command }]),
          }),
        ),
      ),
    )
    const replacementWarnings = Effect.gen(function* () {
      if (result.removed.length > 0)
        yield* io.warn(
          `${input.dryRun ? "Would remove" : "Removed"} ${result.removed.join(", ")}: the new add-ons replace it.`,
        )
      if (result.replacedScripts.length > 0)
        yield* io.warn(
          `${input.dryRun ? "Would replace" : "Replaced"} existing package scripts:\n${result.replacedScripts.map((x) => `  ${x}`).join("\n")}`,
        )
    })
    if (input.json) {
      yield* replacementWarnings
      yield* complete
      return yield* printSuccess({
        dryRun: input.dryRun,
        directory: dir,
        stack: result.stack,
        added: result.added,
        skipped: result.skipped,
        created: result.created,
        changed: changedFiles,
        removed: result.removed,
        replacedScripts: result.replacedScripts,
        packageManager: result.packageManager,
        notes: result.notes,
        installed: installs,
        env: result.envVars,
        nextSteps: steps.map((s) => Object.assign({}, s, { cwd: dir })),
        warnings,
      })
    }

    const changed = result.written.length + result.transformed.length + result.removed.length > 0
    if (!changed) {
      yield* io.info(`Already there: ${result.skipped.join(", ")}`)
      if (!owed) return yield* io.outro("Nothing to do.")
    } else
      yield* io.note(
        [
          ...list(result.created, pc.green("+")),
          ...list(changedFiles, pc.yellow("~")),
          ...list(result.removed, pc.red("-")),
        ].join("\n"),
        `${input.dryRun ? "Would change" : "Changed"}: ${result.added.map((a) => a.title).join(", ") || "stack"}`,
      )
    yield* replacementWarnings
    if (result.packageManager !== null)
      yield* io.info(
        `${input.dryRun ? "Would raise" : "Raised"} packageManager from ${result.packageManager.from} to ${result.packageManager.to}: older pnpm ignores the overrides that keep Effect's packages on one version.`,
      )
    for (const note of result.notes) yield* io.warn(note)
    if (input.dryRun) return yield* io.outro(pc.dim("dry run: nothing written"))

    yield* complete
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
    // under --json a stopped add still prints its one document (Ctrl-C, SIGTERM, a timeout)
    Effect.onInterrupt(() =>
      input.json
        ? Effect.gen(function* () {
            const args = yield* Invocation
            yield* report(true, addInterrupted(args, dir, progress))
            yield* Effect.sync(() => {
              process.exitCode = 130
            })
          })
        : Effect.void,
    ),
    Effect.catch((e) =>
      Effect.gen(function* () {
        const args = yield* Invocation
        yield* report(input.json, addFailure(e as never, args, dir))
      }),
    ),
  )
}

/** The `Interrupted` document of an `add` that was stopped, by how far it got. */
const addInterrupted = (
  args: ReadonlyArray<string>,
  dir: string,
  progress: {
    readonly phase: "planning" | "writing" | "written"
    readonly pending: ReadonlyArray<string>
    readonly partial: object | undefined
  },
): Failure => {
  const rel = relative(process.cwd(), dir) || "."
  switch (progress.phase) {
    case "planning":
      return {
        code: "Interrupted",
        message: "Stopped before anything was written. Run the same command again.",
        fix: null,
        details: { directory: dir, written: false, remaining: [] },
      }
    case "writing":
      return {
        code: "Interrupted",
        message: `Stopped while writing files, so some of them may be written. See git status in ${rel}; running the same command again finishes what it can.`,
        fix: null,
        details: { directory: dir, written: true, remaining: [] },
      }
    case "written":
      return {
        code: "Interrupted",
        message:
          progress.pending.length === 0
            ? `Stopped after the files were written; ${rel} has everything this add needed.`
            : `Stopped. The files were written; to finish, run in ${rel}: ${progress.pending.join(", then ")}`,
        fix: finish(args, dir, progress.pending),
        details: { written: true, remaining: progress.pending, ...progress.partial },
      }
  }
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
