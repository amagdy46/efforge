import { NodeFileSystem } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect, FileSystem, Path, Schema } from "effect"
import { parse } from "yaml"
import { type LoadedAddon, loadAddons } from "../src/addon.ts"
import { generate } from "../src/generate.ts"
import { EfforgeManifest, hash, manifestHeader } from "../src/manifest.ts"
import { type StackConfig, withDefaults } from "../src/stack.ts"
import { versions } from "../src/versions.ts"

const fixtures = new URL("./fixtures/templates", import.meta.url).pathname

const run = <A, E>(eff: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.runPromise(eff.pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Path.layer)))

const gen = (config: StackConfig, tweak?: (a: Map<string, LoadedAddon>) => void) =>
  run(
    Effect.gen(function* () {
      const addons = new Map(yield* loadAddons(fixtures))
      tweak?.(addons)
      return yield* generate(config, addons)
    }),
  )

const pg = withDefaults({ name: "app", database: "postgres", auth: "none", extras: ["email"] })
const d1 = withDefaults({
  name: "app",
  database: "d1",
  orm: "none",
  auth: "none",
  extras: ["email"],
})

const patch = (a: Map<string, LoadedAddon>, id: string, over: object) => {
  const l = a.get(id) as LoadedAddon
  a.set(id, { ...l, manifest: { ...l.manifest, ...over } })
}

it("later add-on's file replaces the earlier one", async () => {
  const tree = await gen(pg)
  expect(tree.get("apps/web/src/db.ts")).toBe('export const db = "postgres"\n')
})

it("skips files whose when does not match", async () => {
  expect((await gen(pg)).has("apps/web/src/outbox.ts")).toBe(true)
  const tree = await gen(d1)
  expect(tree.has("apps/web/src/outbox.ts")).toBe(false)
  expect(tree.has("apps/web/src/mailer.ts")).toBe(true)
})

it("merges deps from several add-ons as catalog:, sorted", async () => {
  const pkg = JSON.parse((await gen(pg)).get("apps/web/package.json") as string)
  expect(pkg.name).toBe("web")
  expect(pkg.dependencies).toEqual({
    "@effect/sql-pg": "catalog:",
    "drizzle-orm": "catalog:",
    effect: "catalog:",
    "zod-existing": "1.0.0",
  })
  expect(Object.keys(pkg.dependencies)).toEqual(Object.keys(pkg.dependencies).toSorted())
  expect(pkg.devDependencies).toEqual({ "drizzle-kit": "catalog:" })
})

it("catalog lists only used packages at pinned versions", async () => {
  const ws = parse((await gen(pg)).get("pnpm-workspace.yaml") as string)
  expect(ws.packages).toEqual(["apps/*", "packages/*"])
  expect(ws.catalog).toEqual({
    "@effect/sql-pg": versions["@effect/sql-pg"],
    "drizzle-kit": versions["drizzle-kit"],
    "drizzle-orm": versions["drizzle-orm"],
    effect: versions.effect,
  })
  expect(parse((await gen(d1)).get("pnpm-workspace.yaml") as string).catalog).toEqual({
    effect: versions.effect,
  })
})

it("links @repo/* dependencies as workspace:* and keeps them out of the catalog", async () => {
  const tree = await run(
    Effect.gen(function* () {
      const addons = new Map(yield* loadAddons(fixtures))
      patch(addons, "database/postgres", { dependencies: { "apps/web": ["@repo/db", "effect"] } })
      return yield* generate(pg, addons)
    }),
  )
  const pkg = JSON.parse(tree.get("apps/web/package.json") as string)
  expect(pkg.dependencies["@repo/db"]).toBe("workspace:*")
  expect(pkg.dependencies.effect).toBe("catalog:")
  expect(parse(tree.get("pnpm-workspace.yaml") as string).catalog["@repo/db"]).toBeUndefined()
})

it("merges add-on scripts into the target package.json, creating the scripts object", async () => {
  const tree = await run(
    Effect.gen(function* () {
      const addons = new Map(yield* loadAddons(fixtures))
      patch(addons, "database/postgres", { scripts: { "apps/web": { "db:migrate": "run-it" } } })
      patch(addons, "orm/drizzle", { scripts: { "apps/web": { "db:generate": "gen-it" } } })
      return yield* generate(pg, addons)
    }),
  )
  const pkg = JSON.parse(tree.get("apps/web/package.json") as string)
  expect(pkg.scripts).toMatchObject({ "db:migrate": "run-it", "db:generate": "gen-it" })
  expect(pkg.name).toBe("web")
})

it("fails with missing-package-json when scripts target an absent package", async () => {
  const r = await run(
    Effect.gen(function* () {
      const addons = new Map(yield* loadAddons(fixtures))
      patch(addons, "database/postgres", { scripts: { "apps/nope": { x: "y" } } })
      return yield* Effect.flip(generate(pg, addons))
    }),
  )
  expect(r).toMatchObject({ reason: "missing-package-json", path: "apps/nope/package.json" })
})

it(".env.example is deduplicated and grouped by add-on title", async () => {
  const env = (await gen(pg)).get(".env.example")
  expect(env).toBe(
    "# Postgres\nDATABASE_URL=postgres://localhost/app\n\n# Email\nMAIL_FROM=hi@example.com\n",
  )
})

it("efforge.jsonc round-trips through EfforgeManifest and hashes match overlay targets", async () => {
  const tree = await gen(pg)
  const text = tree.get("efforge.jsonc") as string
  expect(text.startsWith(manifestHeader)).toBe(true)
  const m = Schema.decodeUnknownSync(EfforgeManifest)(JSON.parse(text.slice(manifestHeader.length)))
  expect(m.stack).toEqual(pg)
  expect(m.command).toBe("npm create efforge app -- --auth=none --extras=email")
  expect(Object.keys(m.files)).toEqual([
    "apps/web/src/db.ts",
    "apps/web/src/mailer.ts",
    "apps/web/src/outbox.ts",
  ]) // schema.ts is edited by a transform, so it is a seam file and not hash-tracked
  for (const [target, h] of Object.entries(m.files))
    expect(h).toBe(hash(tree.get(target) as string))
  expect(hash("x")).toHaveLength(16)
})

it("is deterministic: same input gives a byte-identical tree", async () => {
  const a = await gen(pg)
  const b = await gen(pg)
  expect([...a]).toEqual([...b])
  expect([...a.keys()]).toEqual([...a.keys()].toSorted())
})

it("fails with unpinned for a package missing from versions", async () => {
  const r = await run(
    Effect.gen(function* () {
      const addons = new Map(yield* loadAddons(fixtures))
      patch(addons, "database/postgres", { dependencies: { "apps/web": ["left-pad"] } })
      return yield* Effect.flip(generate(pg, addons))
    }),
  )
  expect(r).toMatchObject({ _tag: "GenerateError", reason: "unpinned", package: "left-pad" })
})

it("fails with missing-package-json when the target package.json is absent", async () => {
  const r = await run(
    Effect.gen(function* () {
      const addons = new Map(yield* loadAddons(fixtures))
      patch(addons, "database/postgres", { dependencies: { "apps/nope": ["effect"] } })
      return yield* Effect.flip(generate(pg, addons))
    }),
  )
  expect(r).toMatchObject({
    _tag: "GenerateError",
    reason: "missing-package-json",
    path: "apps/nope/package.json",
  })
})

it("fails with invalid-json when a package.json is malformed", async () => {
  const r = await run(
    Effect.gen(function* () {
      const addons = new Map(yield* loadAddons(fixtures))
      const fs = yield* FileSystem.FileSystem
      const dir = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie)
      yield* fs.writeFileString(`${dir}/bad.json`, "{").pipe(Effect.orDie)
      addons.set("database/postgres", {
        dir,
        manifest: {
          ...(addons.get("database/postgres") as LoadedAddon).manifest,
          files: [{ path: "bad.json", target: "apps/web/package.json" }],
        },
      })
      return yield* Effect.flip(generate(pg, addons))
    }).pipe(Effect.scoped),
  )
  expect(r).toMatchObject({ _tag: "GenerateError", reason: "invalid-json" })
})

it("applies all overlays before any transform, so a later overlay cannot clobber a transform", async () => {
  const tree = await gen(pg, (a) =>
    patch(a, "base", {
      transforms: [
        {
          name: "addImport",
          args: { file: "apps/web/src/db.ts", import: "Effect", from: "effect" },
        },
      ],
    }),
  )
  // database/postgres overlays db.ts after base declared the transform
  expect(tree.get("apps/web/src/db.ts")).toBe(
    'import { Effect } from "effect"\nexport const db = "postgres"\n',
  )
})

it("`.` as a dependency dir targets the root package.json", async () => {
  const tree = await gen(pg, (a) => patch(a, "base", { devDependencies: { ".": ["effect"] } }))
  expect(JSON.parse(tree.get("package.json") as string).devDependencies).toEqual({
    effect: "catalog:",
  })
})

it("a package with a Dockerfile gets exact versions, not catalog:,", async () => {
  const tree = await gen(pg, (a) => {
    const base = a.get("base") as LoadedAddon
    patch(a, "base", {
      files: [
        ...base.manifest.files,
        { path: "files/web/package.json", target: "apps/img/package.json" },
        { path: "files/src/db.ts", target: "apps/img/Dockerfile" },
      ],
      dependencies: { ...base.manifest.dependencies, "apps/img": ["effect"] },
    })
  })
  expect(JSON.parse(tree.get("apps/img/package.json") as string).dependencies.effect).toBe(
    versions.effect,
  )
  expect(JSON.parse(tree.get("apps/web/package.json") as string).dependencies.effect).toBe(
    "catalog:",
  )
})
