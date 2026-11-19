import { Effect, FileSystem, Path, Schema } from "effect"
import { parseDocument } from "yaml"
import type { LoadedAddon, When } from "./addon.ts"
import { addonIdsFor } from "./addon.ts"
import { presentCardTransforms } from "./cards.ts"
import { hash, manifestSchemaUrl, renderManifest } from "./manifest.ts"
import { applyProjectName } from "./projectName.ts"
import { syncAgents } from "./agents.ts"
import { ENV_EXAMPLE, envExample, envGroups, localEnv, localEnvFile } from "./env.ts"
import { AGENTS_FILE } from "./transforms/appendAgentsSection.ts"
import { fillReadme, README_FILE, readmeRegions } from "./readme.ts"
import { SlotId, type StackConfig, toCommand } from "./stack.ts"
import {
  runTransform,
  type TransformAnchorMissing,
  type UnknownTransform,
} from "./transforms/index.ts"
import type { Tree } from "./tree.ts"
import { effectOverrides, effectVersion, efforgeVersion, versions } from "./versions.ts"

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

/** `engines`, then `packageManager`, go last, where the formatter (sort-package-json) puts them. */
const json = (value: unknown): string => {
  const { engines, packageManager, ...rest } = value as Record<string, unknown>
  const ordered = {
    ...rest,
    ...(engines === undefined ? {} : { engines }),
    ...(packageManager === undefined ? {} : { packageManager }),
  }
  return `${JSON.stringify(ordered, null, 2)}\n`
}
const sortKeys = (o: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(o).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

// .dev.vars and .env are gitignored local settings, never hashed
const computedNames = new Set([
  "pnpm-workspace.yaml",
  ".env.example",
  "efforge.jsonc",
  ".dev.vars",
  ".env",
])
export const isComputed = (target: string) =>
  computedNames.has(target) || target === "package.json" || target.endsWith("/package.json")

/** Packages of the generated monorepo (`@repo/*`) link via `workspace:*`; they have no pinned version. */
const isWorkspace = (name: string) => name.startsWith("@repo/")

/** The `scripts` of a package.json, or none when it is missing or not JSON. */
export const rootScripts = (text: string | undefined): Record<string, string> => {
  try {
    const pkg = JSON.parse(text ?? "{}") as { scripts?: Record<string, string> }
    return pkg.scripts ?? {}
  } catch {
    return {}
  }
}

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
      for (const f of [...manifest.files, ...(manifest.card?.files ?? [])]) {
        if (!matches(f.when, config)) continue
        if (f.ifAbsent === true && tree.has(f.target)) continue
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
      const editPackage = (pkgDir: string, edit: (pkg: Record<string, unknown>) => void) =>
        Effect.gen(function* () {
          const target = pkgDir === "." ? "package.json" : `${pkgDir}/package.json`
          const text = tree.get(target)
          if (text === undefined)
            return yield* new GenerateError({
              reason: "missing-package-json",
              path: target,
              message: `${manifest.id} adds dependencies or scripts to ${target}, which does not exist`,
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
          edit(pkg)
          tree = new Map(tree).set(target, json(pkg))
        })

      for (const [key, section] of [
        ["dependencies", manifest.dependencies],
        ["devDependencies", manifest.devDependencies],
      ] as const) {
        for (const [pkgDir, names] of Object.entries(section)) {
          const unpinned = names.find((name) => !isWorkspace(name) && versions[name] === undefined)
          if (unpinned !== undefined)
            return yield* new GenerateError({
              reason: "unpinned",
              package: unpinned,
              message: `${manifest.id} uses "${unpinned}", which has no entry in versions.ts`,
            })
          // a Docker build context can't see the root catalog, so such a package pins exact versions
          const standalone = tree.has(`${pkgDir === "." ? "" : `${pkgDir}/`}Dockerfile`)
          yield* editPackage(pkgDir, (pkg) => {
            const deps = { ...(pkg[key] as Record<string, string> | undefined) }
            for (const name of names) {
              if (isWorkspace(name)) {
                deps[name] = "workspace:*"
              } else if (standalone) {
                deps[name] = versions[name] as string
              } else {
                deps[name] = "catalog:"
                used.add(name)
              }
            }
            pkg[key] = sortKeys(deps)
          })
        }
      }

      for (const [pkgDir, scripts] of Object.entries(manifest.scripts ?? {}))
        yield* editPackage(pkgDir, (pkg) => {
          pkg.scripts = {
            ...(pkg.scripts as Record<string, string> | undefined),
            ...scripts,
          }
        })
    }

    // 3. every transform, in add-on order; an add-on's card transforms (its own, the session guard,
    // the registration) run after the add-on's, when the card was written
    for (const { manifest } of loaded) {
      const card = presentCardTransforms(manifest, (file) => tree.has(file))
      for (const t of [...manifest.transforms, ...card]) {
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

    // AGENTS.md's sections, in the add-ons' order, as `add` keeps them
    const agents = out.get(AGENTS_FILE)
    if (agents !== undefined) {
      const synced = syncAgents(agents, config, addons)
      if (synced.kind === "synced") out.set(AGENTS_FILE, synced.text)
    }

    // the README's marked regions describe the final stack; `add` rewrites them, so the README is a
    // seam, never hash-checked
    const readme = out.get(README_FILE)
    if (readme !== undefined) {
      const filled = fillReadme(
        readme,
        readmeRegions({
          stack: config,
          addons,
          scripts: rootScripts(out.get("package.json")),
        }),
      )
      if (filled.kind === "filled") {
        out.set(README_FILE, filled.text)
        seams.add(README_FILE)
      }
    }

    // keep the template's other keys and comments (e.g. `allowBuilds`); `catalog` is always
    // computed, and `overrides` always holds every Effect package at the `effect` pin
    const workspace = parseDocument(out.get("pnpm-workspace.yaml") ?? "")
    if (!workspace.has("packages")) workspace.set("packages", DEFAULT_PACKAGES)
    for (const [name, version] of Object.entries(effectOverrides(effectVersion)))
      workspace.setIn(["overrides", name], version)
    const catalog = Object.fromEntries([...used].toSorted().map((n) => [n, versions[n] as string]))
    workspace.set("catalog", catalog)
    out.set("pnpm-workspace.yaml", workspace.toString())

    // local settings: .env.example (committed) and the file `pnpm dev` reads, with the same values
    const groups = envGroups(config, addons)
    if (groups.length > 0) {
      out.set(ENV_EXAMPLE, envExample(config, groups))
      out.set(localEnvFile(config), localEnv(groups))
    }

    const files = Object.fromEntries(
      [...overlay]
        .filter((t) => !isComputed(t) && !seams.has(t) && out.has(t))
        .toSorted()
        .map((t) => [t, hash(out.get(t) as string)]),
    )
    out.set(
      "efforge.jsonc",
      renderManifest({
        $schema: manifestSchemaUrl(),
        efforgeVersion,
        stack: config,
        command: toCommand(config),
        files,
      }),
    )

    return new Map([...out].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  })
