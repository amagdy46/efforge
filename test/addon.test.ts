import { execFileSync } from "node:child_process"
import { join, relative } from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect, FileSystem, Path } from "effect"
import { AddonLoadError, addonIdsFor, loadAddons } from "../src/addon.ts"
import { slots } from "../src/slots.ts"
import { withDefaults } from "../src/stack.ts"

const real = new URL("../templates", import.meta.url).pathname
const fixtures = new URL("./fixtures/templates", import.meta.url).pathname

const run = <A, E>(eff: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.runPromise(eff.pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Path.layer)))

for (const [name, dir] of [
  ["templates/", real],
  ["fixtures", fixtures],
] as const) {
  it(`${name}: decodes every addon.json with consistent ids`, async () => {
    const addons = await run(loadAddons(dir))
    expect(addons.has("base")).toBe(true)
    for (const [id, a] of addons) expect(a.manifest.id).toBe(id)
  })

  it(`${name}: requires/conflicts ids exist and files exist on disk`, async () => {
    const addons = await run(loadAddons(dir))
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        for (const { manifest, dir: d } of addons.values()) {
          for (const id of [...manifest.requires, ...manifest.conflicts])
            expect(addons.has(id), `${manifest.id} -> ${id}`).toBe(true)
          for (const f of manifest.files)
            expect(yield* fs.exists(path.join(d, f.path)), f.path).toBe(true)
        }
      }),
    )
  })
}

it("fixtures: manifests carry requires, when and transforms", async () => {
  const addons = await run(loadAddons(fixtures))
  expect([...addons.keys()].toSorted()).toEqual([
    "ai/effect-ai-byok",
    "base",
    "database/d1",
    "database/postgres",
    "extras/email",
    "orm/drizzle",
    "runtime/cloudflare",
  ])
  expect(addons.get("orm/drizzle")?.manifest.requires).toEqual(["database/postgres"])
  expect(addons.get("extras/email")?.manifest.files[1]?.when).toEqual({ database: ["postgres"] })
  expect(addons.get("orm/drizzle")?.manifest.transforms[0]?.name).toBe("addImport")
})

it("every non-none option in slots has a template folder", async () => {
  const addons = await run(loadAddons(real))
  for (const slot of slots)
    for (const option of slot.options)
      if (option.id !== "none") expect(addons.has(`${slot.id}/${option.id}`), option.id).toBe(true)
})

const scratch = (files: Record<string, string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = yield* fs.makeTempDirectory()
    for (const [rel, content] of Object.entries(files)) {
      yield* fs.makeDirectory(path.dirname(path.join(dir, rel)), { recursive: true })
      yield* fs.writeFileString(path.join(dir, rel), content)
    }
    return dir
  })

const manifest = (over: Record<string, unknown>) =>
  JSON.stringify({
    id: "base",
    title: "t",
    description: "d",
    files: [],
    dependencies: {},
    devDependencies: {},
    envVars: [],
    requires: [],
    conflicts: [],
    transforms: [],
    ...over,
  })

const failure = (files: Record<string, string>) =>
  run(scratch(files).pipe(Effect.flatMap(loadAddons), Effect.flip))

it("fails with AddonLoadError on a missing file", async () => {
  const err = await failure({
    "base/addon.json": manifest({ files: [{ path: "nope.txt", target: "x" }] }),
  })
  expect(err).toBeInstanceOf(AddonLoadError)
  expect(err.reason).toBe("missing-file")
})

it("fails with AddonLoadError on an unknown requires id", async () => {
  const err = await failure({ "base/addon.json": manifest({ requires: ["orm/ghost"] }) })
  expect(err).toBeInstanceOf(AddonLoadError)
  expect(err.reason).toBe("unknown-reference")
})

it("fails with AddonLoadError on an unknown conflicts id", async () => {
  const err = await failure({ "base/addon.json": manifest({ conflicts: ["orm/ghost"] }) })
  expect(err.reason).toBe("unknown-reference")
})

it("fails with AddonLoadError on invalid json and invalid schema", async () => {
  expect((await failure({ "base/addon.json": "{nope" })).reason).toBe("invalid")
  expect((await failure({ "base/addon.json": '{"id":"base"}' })).reason).toBe("invalid")
})

it("fails when id does not match the folder", async () => {
  const err = await failure({ "base/addon.json": manifest({ id: "orm/drizzle" }) })
  expect(err.reason).toBe("id-mismatch")
})

it("fails when there is no base add-on", async () => {
  const err = await failure({
    "orm/drizzle/addon.json": manifest({ id: "orm/drizzle" }),
  })
  expect(err.reason).toBe("no-base")
})

it("addonIdsFor lists base, non-none slots, then extras in slot order", () => {
  expect(addonIdsFor(withDefaults({ name: "a" }))).toEqual([
    "base",
    "runtime/cloudflare",
    "database/postgres",
    "orm/drizzle",
    "auth/better-auth-orgs",
  ])
  expect(
    addonIdsFor(
      withDefaults({
        name: "a",
        database: "none",
        infra: "alchemy",
        ai: "effect-ai-byok",
        extras: ["email", "storage"],
      }),
    ),
  ).toEqual([
    "base",
    "runtime/cloudflare",
    "infra/alchemy",
    "ai/effect-ai-byok",
    "extras/storage",
    "extras/email",
  ])
})

it("addonIdsFor is independent of the order extras were given", () => {
  const a = addonIdsFor(withDefaults({ name: "a", extras: ["email", "workflows", "storage"] }))
  const b = addonIdsFor(withDefaults({ name: "a", extras: ["storage", "email", "workflows"] }))
  expect(a).toEqual(b)
})

it("every template file survives pnpm pack", async () => {
  // pnpm pack silently drops some names (package-lock.json at any depth, .npmrc, ...); the
  // published CLI then fails to load its templates, so check the real file list.
  const root = new URL("..", import.meta.url).pathname
  const packed = JSON.parse(
    execFileSync("pnpm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8" }),
  ) as { files: { path: string }[] }
  const shipped = new Set(packed.files.map((f) => f.path))
  const addons = await run(loadAddons(real))
  for (const addon of addons.values())
    for (const f of addon.manifest.files) {
      const file = relative(root, join(addon.dir, f.path))
      expect(shipped.has(file), file).toBe(true)
    }
})
