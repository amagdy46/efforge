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

it("names the project: package.json, wrangler.jsonc and README heading, with consistent hashes", async () => {
  const { hash } = await import("../src/manifest.ts")
  const tree = await run(
    Effect.gen(function* () {
      return yield* generate({ ...minimal, name: "spoorline" }, yield* loadAddons(templates))
    }),
  )
  expect(JSON.parse(tree.get("package.json") as string).name).toBe("spoorline")
  expect(tree.get("wrangler.jsonc")).toContain('"name": "spoorline"')
  expect((tree.get("README.md") as string).split("\n")[0]).toBe("# spoorline")
  const manifest = JSON.parse((tree.get("efforge.jsonc") as string).replace(/^\/\/.*\n/, ""))
  expect(manifest.files["README.md"]).toBe(hash(tree.get("README.md") as string))
  expect(manifest.files["wrangler.jsonc"]).toBe(hash(tree.get("wrangler.jsonc") as string))
})

it("the minimal stack lints with Vite+, not Biome, and ships agent instructions", async () => {
  const tree = await gen()
  expect(tree.has("biome.json")).toBe(false)
  expect(tree.has("vite.config.ts")).toBe(true)
  const root = JSON.parse(tree.get("package.json") as string)
  expect(root.scripts).toMatchObject({ lint: "vp lint", format: "vp fmt", check: "vp check" })
  expect(root.devDependencies["vite-plus"]).toBe("catalog:")
  expect(root.devDependencies["@biomejs/biome"]).toBeUndefined()
  const agents = tree.get("AGENTS.md") as string
  expect(agents.split("\n").length).toBeLessThan(120)
  expect(agents.trimEnd().endsWith("<!-- efforge:agents -->")).toBe(true)
  expect(agents).toContain("pnpm check && pnpm typecheck && pnpm test && pnpm build")
  expect(tree.get("CLAUDE.md")).toBe("@AGENTS.md\n")
})

it("no template mentions Biome, and add-on sections reach AGENTS.md exactly once", async () => {
  const stack = withDefaults({
    name: "app",
    database: "postgres",
    orm: "drizzle",
    auth: "none",
    infra: "alchemy",
    ai: "none",
    extras: ["storage", "realtime"],
  })
  const tree = await run(
    Effect.gen(function* () {
      return yield* generate(stack, yield* loadAddons(templates))
    }),
  )
  for (const [file, text] of tree) expect(text, file).not.toMatch(/biome/i)
  const agents = tree.get("AGENTS.md") as string
  for (const id of ["database", "storage", "realtime"])
    expect(agents.split(`<!-- efforge:section:${id} -->`).length - 1, id).toBe(1)
  expect(agents.trimEnd().endsWith("<!-- efforge:agents -->")).toBe(true)
})
