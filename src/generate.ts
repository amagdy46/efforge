import { Effect, FileSystem, Path, Schema } from "effect"
import { parse, stringify } from "yaml"
import type { LoadedAddon, When } from "./addon.ts"
import { addonIdsFor } from "./addon.ts"
import { hash, renderManifest } from "./manifest.ts"
import { applyProjectName } from "./projectName.ts"
import { SlotId, type StackConfig, toCommand } from "./stack.ts"
import {
  runTransform,
  type TransformAnchorMissing,
  type UnknownTransform,
} from "./transforms/index.ts"
import type { Tree } from "./tree.ts"
import { efforgeVersion, versions } from "./versions.ts"

export class GenerateError extends Schema.TaggedError<GenerateError>()("GenerateError", {
  reason: Schema.Literals([
    "unsafe-path",
    "unpinned",
    "missing-package-json",
    "invalid-json",
    "unknown-addon",
    "io",
  ]),
  package: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
  message: Schema.String,
}) {}

/** Every listed slot must match; for `extras`, at least one chosen extra must be listed. */
export const matches = (when: When | undefined, config: StackConfig): boolean => {
  if (when === undefined) return true
  return SlotId.literals.every((slot) => {
    const allowed = when[slot]
    if (allowed === undefined) return true
    return slot === "extras"
      ? config.extras.some((e) => allowed.includes(e))
      : allowed.includes(config[slot])
  })
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`
const sortKeys = (o: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

const computedNames = new Set(["pnpm-workspace.yaml", ".env.example", "efforge.jsonc"])
export const isComputed = (target: string) =>
  computedNames.has(target) || target === "package.json" || target.endsWith("/package.json")

const DEFAULT_PACKAGES = ["apps/*", "packages/*"]

/** Builds the project tree for `config` from the loaded add-ons. Pure apart from reading add-on files. */
export const generate = (
  config: StackConfig,
  addons: ReadonlyMap<string, LoadedAddon>,
): Effect.Effect<
  Tree,
  GenerateError | TransformAnchorMissing | UnknownTransform,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    let tree: Tree = new Map()
    const overlay = new Set<string>()
    const seams = new Set<string>()
    const used = new Set<string>()
    const env = new Map<string, { title: string; vars: string[] }>()
    const seenEnv = new Set<string>()

    const loaded: LoadedAddon[] = []
    for (const id of addonIdsFor(config)) {
      const addon = addons.get(id)
      if (addon === undefined)
        return yield* new GenerateError({
          reason: "unknown-addon",
          message: `add-on "${id}" is not loaded`,
        })
      loaded.push(addon)
    }

    // 1. every overlay, in add-on order, so a later overlay can never clobber an earlier edit
    for (const { manifest, dir } of loaded) {
      for (const f of manifest.files) {
        if (!matches(f.when, config)) continue
        const content = yield* fs
          .readFileString(path.join(dir, f.path))
          .pipe(
            Effect.mapError(
              (e) => new GenerateError({ reason: "io", path: f.path, message: e.message }),
            ),
          )
        tree = new Map(tree).set(f.target, content)
        overlay.add(f.target)
      }
    }

    // 2. dependencies and env vars
    for (const { manifest } of loaded) {
      for (const [key, section] of [
        ["dependencies", manifest.dependencies],
        ["devDependencies", manifest.devDependencies],
      ] as const) {
        for (const [pkgDir, names] of Object.entries(section)) {
          const target = pkgDir === "." ? "package.json" : `${pkgDir}/package.json`
          const text = tree.get(target)
          if (text === undefined)
            return yield* new GenerateError({
              reason: "missing-package-json",
              path: target,
              message: `${manifest.id} adds dependencies to ${target}, which does not exist`,
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
          const deps = { ...((pkg[key] as Record<string, string> | undefined) ?? {}) }
          for (const name of names) {
            if (versions[name] === undefined)
              return yield* new GenerateError({
                reason: "unpinned",
                package: name,
                message: `${manifest.id} uses "${name}", which has no entry in versions.ts`,
              })
            deps[name] = "catalog:"
            used.add(name)
          }
          tree = new Map(tree).set(target, json({ ...pkg, [key]: sortKeys(deps) }))
        }
      }

      for (const v of manifest.envVars) {
        if (seenEnv.has(v.name)) continue
        seenEnv.add(v.name)
        const group = env.get(manifest.id) ?? { title: manifest.title, vars: [] }
        group.vars.push(`${v.name}=${v.example}`)
        env.set(manifest.id, group)
      }
    }

    // 3. every transform, in add-on order
    for (const { manifest } of loaded) {
      for (const t of manifest.transforms) {
        if (!matches(t.when, config)) continue
        const before = tree
        tree = yield* runTransform(tree, t)
        // seam files are always re-edited by transforms, never hash-checked by `add`
        for (const [file, content] of tree) if (before.get(file) !== content) seams.add(file)
      }
    }

    // Built-in post-step, after transforms and before hashing, so manifest hashes cover the
    // final (named) content and `add` sees an unedited README/wrangler.jsonc as unchanged.
    const out = new Map(applyProjectName(tree, config.name))

    const workspace = out.get("pnpm-workspace.yaml")
    const { packages = DEFAULT_PACKAGES, ...rest } =
      workspace === undefined ? {} : ((parse(workspace) as { packages?: string[] } | null) ?? {})
    const catalog = Object.fromEntries([...used].sort().map((n) => [n, versions[n] as string]))
    // keep the template's other keys (e.g. `allowBuilds`); `catalog` is always computed
    out.set("pnpm-workspace.yaml", stringify({ packages, ...rest, catalog }))

    if (env.size > 0)
      out.set(
        ".env.example",
        `${[...env.values()].map((g) => `# ${g.title}\n${g.vars.join("\n")}`).join("\n\n")}\n`,
      )

    const files = Object.fromEntries(
      [...overlay]
        .filter((t) => !isComputed(t) && !seams.has(t) && out.has(t))
        .sort()
        .map((t) => [t, hash(out.get(t) as string)]),
    )
    out.set(
      "efforge.jsonc",
      renderManifest({ efforgeVersion, stack: config, command: toCommand(config), files }),
    )

    return new Map([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  })
