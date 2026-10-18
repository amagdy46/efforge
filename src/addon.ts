import { Effect, FileSystem, Path, Schema } from "effect"
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
})

/** workspace package dir (e.g. `apps/web`) -> package names; versions come from `versions.ts`. */
const PackagesByDir = Schema.Record(Schema.String, Strings)

export const AddonManifest = Schema.Struct({
  id: AddonId,
  title: Schema.String,
  description: Schema.String,
  docs: Schema.optionalKey(Schema.String),
  files: Schema.Array(AddonFile),
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
    }),
  ),
  requires: Strings,
  conflicts: Strings,
  transforms: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      args: Schema.Record(Schema.String, Schema.String),
      when: Schema.optionalKey(When),
    }),
  ),
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
      for (const f of manifest.files)
        if (!(yield* io(manifest.id, fs.exists(path.join(dir, f.path)))))
          return yield* fail(
            manifest.id,
            "missing-file",
            `file "${f.path}" does not exist in ${dir}`,
          )
    }
    return addons
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
