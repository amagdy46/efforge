import { Effect, FileSystem, Path, Schema } from "effect"
import { CARDS_DIR, needsGuard, SERVER_DIR, sessionGuard } from "./cards.ts"
import { transformTargets } from "./transforms/index.ts"
import { slots } from "./slots.ts"
import { SlotId, type StackConfig } from "./stack.ts"

const Strings = Schema.Array(Schema.String)

/** Per-slot allow-lists; a file or transform applies only when every listed slot matches. */
export const When = Schema.Struct(
  Object.fromEntries(SlotId.literals.map((s) => [s, Schema.optionalKey(Strings)])) as {
    [K in SlotId]: Schema.optionalKey<typeof Strings>
  },
)
export type When = typeof When.Type

/** `"base"` or `"<slot>/<option>"`. */
export const AddonId = Schema.String.check(Schema.isPattern(/^(?:base|[a-z]+\/[a-z0-9-]+)$/))

export const AddonFile = Schema.Struct({
  /** relative to the add-on directory */
  path: Schema.String,
  /** relative to the project root */
  target: Schema.String,
  when: Schema.optionalKey(When),
  /**
   * Written only where the project has no such file: a base file the add-on needs that an older
   * project lacks. The add-on never replaces it, so it never conflicts with the user's edits.
   */
  ifAbsent: Schema.optionalKey(Schema.Boolean),
})
export type AddonFile = typeof AddonFile.Type

export const AddonTransform = Schema.Struct({
  name: Schema.String,
  args: Schema.Record(Schema.String, Schema.String),
  when: Schema.optionalKey(When),
})
export type AddonTransform = typeof AddonTransform.Type

/**
 * The add-on's capability card on the dashboard (docs/capability-cards.md). `files[0]` is the card
 * module, under apps/web/src/capabilities/, and exports `export` (a `Capability`); the other files
 * are what only the card uses (its server functions, under apps/web/src/server/). `transforms`
 * edit only those files. The files, the transforms, the session guard efforge adds to the server
 * functions on auth stacks and the registration in apps/web/src/capabilities/registry.ts are one
 * unit: written together, or (in a project without a registry) skipped together.
 */
export const AddonCard = Schema.Struct({
  export: Schema.String.check(Schema.isPattern(/^[A-Za-z_$][\w$]*$/)),
  files: Schema.Array(AddonFile).check(Schema.isMinLength(1)),
  transforms: Schema.optionalKey(Schema.Array(AddonTransform)),
})
export type AddonCard = typeof AddonCard.Type

/**
 * Prose for the add-on's page in docs/addons (`pnpm docs:addons`). Everything else on the page
 * comes from the rest of the manifest; this holds only what the manifest cannot say.
 */
export const AddonGuide = Schema.Struct({
  /** What the add-on is for, in a short paragraph. */
  purpose: Schema.String,
  /** The service it adds: class name, the project file that declares it, its tagged errors. */
  service: Schema.optionalKey(
    Schema.Struct({ name: Schema.String, file: Schema.String, errors: Strings }),
  ),
  /** Anything to know before swapping the layer, beyond the standard steps. */
  swap: Schema.optionalKey(Schema.String),
  /** Known gaps, one sentence each. */
  limits: Schema.optionalKey(Strings),
})
export type AddonGuide = typeof AddonGuide.Type

/** workspace package dir (e.g. `apps/web`) -> package names; versions come from `versions.ts`. */
const PackagesByDir = Schema.Record(Schema.String, Strings)

export const AddonManifest = Schema.Struct({
  id: AddonId,
  title: Schema.String,
  description: Schema.String,
  docs: Schema.optionalKey(Schema.String),
  files: Schema.Array(AddonFile),
  card: Schema.optionalKey(AddonCard),
  dependencies: PackagesByDir,
  devDependencies: PackagesByDir,
  /** workspace package dir (`.` for the root) -> script name -> command; an add-on's script replaces one of the same name */
  scripts: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String)),
  ),
  envVars: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      example: Schema.String,
      description: Schema.String,
      when: Schema.optionalKey(When),
    }),
  ),
  requires: Strings,
  conflicts: Strings,
  guide: Schema.optionalKey(AddonGuide),
  transforms: Schema.Array(AddonTransform),
})
export type AddonManifest = typeof AddonManifest.Type

export interface LoadedAddon {
  readonly manifest: AddonManifest
  readonly dir: string
}

export class AddonLoadError extends Schema.TaggedError<AddonLoadError>()("AddonLoadError", {
  addon: Schema.String,
  reason: Schema.Literals([
    "io",
    "invalid",
    "id-mismatch",
    "missing-file",
    "unknown-reference",
    "no-base",
    "invalid-card",
  ]),
  message: Schema.String,
}) {}

/** Loads `<templatesDir>/base` and `<templatesDir>/<slot>/<option>` add-ons and cross-checks them. */
export const loadAddons = (
  templatesDir: string,
): Effect.Effect<
  ReadonlyMap<string, LoadedAddon>,
  AddonLoadError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const fail = (addon: string, reason: AddonLoadError["reason"], message: string) =>
      new AddonLoadError({ addon, reason, message })
    const io = <A>(addon: string, eff: Effect.Effect<A, { message: string }>) =>
      eff.pipe(Effect.mapError((e) => fail(addon, "io", e.message)))

    const dirs: Array<{ id: string; dir: string }> = []
    for (const entry of yield* io(templatesDir, fs.readDirectory(templatesDir))) {
      const dir = path.join(templatesDir, entry)
      if (!(yield* io(dir, fs.stat(dir))).type.startsWith("Directory")) continue
      if (yield* io(dir, fs.exists(path.join(dir, "addon.json")))) {
        dirs.push({ id: entry, dir })
        continue
      }
      for (const option of yield* io(dir, fs.readDirectory(dir))) {
        const optionDir = path.join(dir, option)
        if (yield* io(optionDir, fs.exists(path.join(optionDir, "addon.json"))))
          dirs.push({ id: `${entry}/${option}`, dir: optionDir })
      }
    }

    const addons = new Map<string, LoadedAddon>()
    for (const { id, dir } of dirs.toSorted((a, b) => a.id.localeCompare(b.id))) {
      const file = path.join(dir, "addon.json")
      const text = yield* io(id, fs.readFileString(file))
      const json = yield* Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: (e) => fail(id, "invalid", `${file}: ${String(e)}`),
      })
      const manifest = yield* Schema.decodeUnknownEffect(AddonManifest)(json).pipe(
        Effect.mapError((e) => fail(id, "invalid", `${file}: ${e.message}`)),
      )
      if (manifest.id !== id)
        return yield* fail(id, "id-mismatch", `${file}: id "${manifest.id}" must be "${id}"`)
      addons.set(id, { manifest, dir })
    }

    if (!addons.has("base"))
      return yield* fail("base", "no-base", `${templatesDir}/base/addon.json not found`)

    for (const { manifest, dir } of addons.values()) {
      for (const ref of [...manifest.requires, ...manifest.conflicts])
        if (!addons.has(ref))
          return yield* fail(manifest.id, "unknown-reference", `references unknown add-on "${ref}"`)
      const card = manifest.card
      for (const f of [...manifest.files, ...(card?.files ?? [])])
        if (!(yield* io(manifest.id, fs.exists(path.join(dir, f.path)))))
          return yield* fail(
            manifest.id,
            "missing-file",
            `file "${f.path}" does not exist in ${dir}`,
          )
      if (card !== undefined) {
        const message = yield* cardProblem(card, (f) =>
          io(manifest.id, fs.readFileString(path.join(dir, f.path))),
        )
        if (message !== undefined) return yield* fail(manifest.id, "invalid-card", message)
      }
      // every server function an add-on writes requires a session on auth stacks, wherever the
      // add-on lists its file: the guard is derived here, so an add-on never has to declare it
      const guarded = new Set(
        manifest.transforms
          .filter((t) => t.name === "addServerFnMiddleware")
          .map((t) => t.args.file),
      )
      const guards: AddonTransform[] = []
      for (const f of manifest.files)
        if (
          !guarded.has(f.target) &&
          needsGuard(f.target, yield* io(manifest.id, fs.readFileString(path.join(dir, f.path))))
        ) {
          guarded.add(f.target)
          guards.push(sessionGuard(f))
        }
      if (guards.length > 0)
        addons.set(manifest.id, {
          manifest: { ...manifest, transforms: [...manifest.transforms, ...guards] },
          dir,
        })
    }
    return addons
  })

/**
 * Why `card` breaks the contract in docs/capability-cards.md, or undefined. The module comes first
 * and lives under apps/web/src/capabilities/; server functions (`createServerFn`) live only in the
 * card's files under apps/web/src/server/, so efforge can guard every one of them on auth stacks;
 * and the card's transforms edit only the card's own files.
 */
const cardProblem = <E>(
  card: AddonCard,
  read: (file: AddonFile) => Effect.Effect<string, E>,
): Effect.Effect<string | undefined, E> =>
  Effect.gen(function* () {
    const module = card.files[0] as AddonFile
    if (!module.target.startsWith(CARDS_DIR))
      return `the card module (card.files[0]) must be under ${CARDS_DIR}`
    for (const f of card.files) {
      const serverFns = /\bcreateServerFn\s*\(/.test(yield* read(f))
      const inServer = f !== module && f.target.startsWith(SERVER_DIR)
      if (serverFns && !inServer)
        return `${f.target} calls createServerFn: a card's server functions go in its own files under ${SERVER_DIR}, so efforge can guard them on auth stacks`
      if (inServer && !serverFns)
        return `${f.target} is a card file under ${SERVER_DIR} without a createServerFn: put helpers elsewhere`
    }
    const own = new Set(card.files.map((f) => f.target))
    for (const t of card.transforms ?? [])
      for (const file of transformTargets(t))
        if (!own.has(file))
          return `card transform ${t.name} edits ${file}, which is not one of the card's files: put it under transforms`
    return undefined
  })

/** `base`, then one id per slot whose value isn't `none`, then the extras, all in slot order (later overlays win). */
export const addonIdsFor = (config: StackConfig): string[] => {
  const ids = ["base"]
  for (const slot of slots) {
    if (slot.id === "extras") {
      // canonical slot-option order, so overlay order doesn't depend on the order extras were given
      const order = slot.options.map((o) => o.id)
      const chosen = [...new Set(config.extras)].toSorted(
        (a, b) => order.indexOf(a) - order.indexOf(b),
      )
      ids.push(...chosen.map((e) => `extras/${e}`))
    } else if (config[slot.id] !== "none") ids.push(`${slot.id}/${config[slot.id]}`)
  }
  return ids
}
