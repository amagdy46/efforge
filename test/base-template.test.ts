import { NodeFileSystem } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect, type FileSystem, Path } from "effect"
import { type LoadedAddon, loadAddons } from "../src/addon.ts"
import { generate } from "../src/generate.ts"
import { withDefaults } from "../src/stack.ts"
import { runTransform } from "../src/transforms/index.ts"

const templates = new URL("../templates", import.meta.url).pathname

const run = <A, E>(eff: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.runPromise(eff.pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Path.layer)))

const minimal = withDefaults({
  name: "app",
  database: "none",
  orm: "none",
  auth: "none",
  infra: "none",
  ai: "none",
  extras: [],
})

const gen = () =>
  run(
    Effect.gen(function* () {
      return yield* generate(minimal, yield* loadAddons(templates))
    }),
  )

const layerArgs = {
  file: "apps/web/src/server/layers.ts",
  import: "Thing",
  from: "@repo/core",
  layer: "Thing.layer",
}

it("the minimal stack has the seam files and wrangler.jsonc", async () => {
  const tree = await gen()
  for (const f of [
    "apps/web/src/server/layers.ts",
    "apps/web/src/server/runtime.ts",
    "packages/core/src/index.ts",
    "wrangler.jsonc",
    "apps/web/vite.config.ts",
    "apps/web/src/routeTree.gen.ts",
  ])
    expect(tree.has(f), f).toBe(true)
  const app = JSON.parse(tree.get("apps/web/package.json") as string)
  expect(app.dependencies["@tanstack/react-start"]).toBe("catalog:")
  expect(tree.get("pnpm-workspace.yaml")).toContain('"@tanstack/react-start": 1.169.3')
})

it("no wrangler.jsonc when infra is alchemy", async () => {
  const tree = await run(
    Effect.gen(function* () {
      const addons = new Map(yield* loadAddons(templates))
      const base = addons.get("base") as LoadedAddon
      // stand-in until the real alchemy add-on exists
      addons.set("infra/alchemy", {
        dir: base.dir,
        manifest: {
          ...base.manifest,
          id: "infra/alchemy",
          files: [],
          dependencies: {},
          devDependencies: {},
        },
      })
      return yield* generate({ ...minimal, infra: "alchemy" }, addons)
    }),
  )
  expect(tree.has("wrangler.jsonc")).toBe(false)
  expect(tree.has("apps/web/vite.config.ts")).toBe(true)
})

it("addLayer appends to the base AppLayer, idempotently", async () => {
  const tree = await gen()
  const once = await run(runTransform(tree, { name: "addLayer", args: layerArgs }))
  const text = once.get(layerArgs.file) as string
  expect(text).toContain("Thing.layer")
  expect(text).toContain('import { Thing } from "@repo/core"')
  expect(text).toContain("Logger.layer")
  const twice = await run(runTransform(once, { name: "addLayer", args: layerArgs }))
  expect(twice.get(layerArgs.file)).toBe(text)
})
