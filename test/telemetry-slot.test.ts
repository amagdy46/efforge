import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, expect, it } from "@effect/vitest"
import { Effect, type Layer, ManagedRuntime } from "effect"
import { parseLayers } from "../src/graph.ts"
import { runTransform, type TransformAnchorMissing } from "../src/transforms/index.ts"

// The base layers.ts has one place for telemetry: `TelemetryLive`, provided underneath AppLayer.
// A tracer there reaches the fibers a layer forks while it builds (an RPC server, a cluster
// runner); one merged beside the other layers does not. Here the real template, edited by the real
// transforms, is built with Effect and a recording tracer.

const repo = new URL("..", import.meta.url).pathname
const LF = "apps/web/src/server/layers.ts"
const template = readFileSync(
  join(repo, "templates/base/files/web/src/server", "layers.ts"),
  "utf8",
)
const cache = join(repo, "node_modules/.cache")
mkdirSync(cache, { recursive: true })
const tmp = mkdtempSync(join(cache, "efforge-telemetry-"))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

/** A tracer that records span names, and a layer whose build forks a fiber that opens a span. */
const fixtures = `import { Effect, Layer, Tracer } from "effect"

export const spans: Array<string> = []
export const RecordingTracer = Layer.succeed(
  Tracer.Tracer,
  Tracer.make({
    span(options) {
      spans.push(options.name)
      return Tracer.nativeTracer.span(options)
    },
  }),
)
export const ForkingLive = Layer.effectDiscard(
  Effect.forkScoped(Effect.void.pipe(Effect.withSpan("forked.at.build"))),
)
`

const edit = (text: string, name: string, args: Record<string, string>) =>
  Effect.runPromise(runTransform(new Map([[LF, text]]), { name, args })).then(
    (tree) => tree.get(LF) as string,
  )

const build = async (name: string, layers: string) => {
  const dir = join(tmp, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "fixtures.ts"), fixtures)
  writeFileSync(join(dir, "layers.ts"), layers)
  const mod = (await import(join(dir, "layers.ts"))) as { AppLayer: Layer.Layer<never> }
  const fx = (await import(join(dir, "fixtures.ts"))) as { spans: Array<string> }
  // as the app runs: one runtime from AppLayer, a request's Effect on it
  const runtime = ManagedRuntime.make(mod.AppLayer)
  await runtime.runPromise(Effect.yieldNow.pipe(Effect.withSpan("request")))
  await runtime.dispose()
  return fx.spans.toSorted()
}

const forking = { file: LF, import: "ForkingLive", from: "./fixtures.ts", layer: "ForkingLive" }
const tracer = {
  file: LF,
  import: "RecordingTracer",
  from: "./fixtures.ts",
  layer: "RecordingTracer",
}

it("a tracer in the telemetry slot reaches fibers a layer forks while it builds", async () => {
  const withLayer = await edit(template, "addLayer", forking)
  const slotted = await edit(withLayer, "addTelemetry", tracer)
  expect(slotted).toContain("Layer.mergeAll(Layer.empty, RecordingTracer /* efforge:telemetry */)")
  expect(await edit(slotted, "addTelemetry", tracer)).toBe(slotted)
  expect(await build("slot", slotted)).toEqual(["forked.at.build", "request"])
  // the same tracer merged beside the layers misses the forked fiber
  const beside = await edit(withLayer, "addLayer", tracer)
  expect(await build("beside", beside)).toEqual(["request"])
})

it("the layer graph and addLayer read AppLayer through the telemetry slot", async () => {
  const withLayer = await edit(template, "addLayer", forking)
  expect(parseLayers(withLayer)?.map((l) => l.name)).toEqual(["Logger.layer", "ForkingLive"])
  expect(withLayer).toContain(".pipe(Layer.provideMerge(TelemetryLive))")
  // a layers.ts made before the slot has no TelemetryLive: addTelemetry says what to write
  const old = template.replace(/\/\*\*\n \* Telemetry[\s\S]*?\n\n/, "")
  const error = (await Effect.runPromise(
    Effect.flip(runTransform(new Map([[LF, old]]), { name: "addTelemetry", args: tracer })),
  )) as TransformAnchorMissing
  expect(error.snippet).toContain("Layer.provideMerge(TelemetryLive)")
})
