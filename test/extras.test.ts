import { NodeFileSystem } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect, Path } from "effect"
import { parse } from "jsonc-parser"
import { loadAddons } from "../src/addon.ts"
import { generate } from "../src/generate.ts"
import { type StackConfig, withDefaults } from "../src/stack.ts"
import { versions } from "../src/versions.ts"

const templates = new URL("../templates", import.meta.url).pathname

const gen = (extras: StackConfig["extras"]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const config = withDefaults({
        name: "app",
        database: "none",
        orm: "none",
        auth: "none",
        infra: "none",
        ai: "none",
        extras,
      })
      return yield* generate(config, yield* loadAddons(templates))
    }).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Path.layer)),
  )

const all: StackConfig["extras"] = ["storage", "workflows", "realtime", "browser"]

it("each extra re-exports its Worker classes from the entry, idempotently regardless of order", async () => {
  const entry = (await gen(all)).get("apps/web/src/server.ts") as string
  for (const line of [
    'export { Example } from "./workflows/Example"',
    'export { Room } from "./realtime/Room"',
    'export { BrowserContainer } from "./browser/BrowserContainer"',
  ])
    expect(entry).toContain(line)
  expect(entry.match(/export \{ Room \}/g)).toHaveLength(1)
  expect(
    ((await gen(["realtime"])).get("apps/web/src/server.ts") as string).includes("Example"),
  ).toBe(false)
})

it("registers layers, routes, widgets and core exports", async () => {
  const tree = await gen(all)
  const layers = tree.get("apps/web/src/server/layers.ts") as string
  for (const l of ["JobsLive", "RealtimeLive", "BrowserLive", "StorageLive"])
    expect(layers).toMatch(new RegExp(`\\b${l},?\\s`))
  const routes = tree.get("apps/web/src/server/routes.ts") as string
  expect(routes).toContain("realtimeRoute")
  expect(routes).toContain("storageRoute")
  expect(tree.get("apps/web/src/components/widgets.tsx")).toContain("<RealtimeDemo")
  const core = tree.get("packages/core/src/index.ts") as string
  for (const m of ["jobs", "realtime", "browser", "storage"])
    expect(core).toContain(`export * from "./${m}"`)
})

it("puts every binding in wrangler.jsonc and keeps containers off in dev", async () => {
  const w = parse((await gen(all)).get("wrangler.jsonc") as string)
  expect(w.main).toBe("apps/web/src/server.ts")
  expect(w.workflows).toEqual([
    { name: "example", binding: "EXAMPLE_WORKFLOW", class_name: "Example" },
  ])
  expect(w.durable_objects.bindings.map((b: { name: string }) => b.name)).toEqual([
    "ROOM",
    "BROWSER",
  ])
  expect(w.migrations.map((m: { tag: string }) => m.tag)).toEqual(["realtime-v1", "browser-v1"])
  expect(w.r2_buckets).toEqual([{ binding: "STORAGE" }])
  expect(w.containers[0].class_name).toBe("BrowserContainer")
  expect(w.dev.enable_containers).toBe(false)
})

it("apps/browser builds outside the workspace: exact pins, and an image tag matching playwright", async () => {
  const tree = await gen(all)
  const pkg = JSON.parse(tree.get("apps/browser/package.json") as string)
  expect(pkg.dependencies.playwright).toBe(versions.playwright)
  expect(pkg.dependencies.effect).toBe(versions.effect)
  expect(JSON.stringify(pkg)).not.toContain("catalog:")
  expect(tree.get("apps/browser/Dockerfile")).toContain(
    `mcr.microsoft.com/playwright:v${versions.playwright}-`,
  )
})

it("no extras: nothing extra is generated", async () => {
  const tree = await gen([])
  expect(tree.has("apps/browser/Dockerfile")).toBe(false)
  expect(tree.get("apps/web/src/server.ts")).not.toContain("export {")
  expect(parse(tree.get("wrangler.jsonc") as string).durable_objects).toBeUndefined()
})
