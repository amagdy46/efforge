import { NodeFileSystem } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Context, Effect, type FileSystem, Layer, ManagedRuntime, Path } from "effect"
import { loadAddons } from "../src/addon.ts"
import { generate } from "../src/generate.ts"
import { parseLayers } from "../src/graph.ts"
import { withDefaults } from "../src/stack.ts"

// An add-on whose layer needs another service provides that service's exported layer constant
// (`Layer.provide(AuthLive)`), so it shares the instance AppLayer holds instead of building a
// second one. That works because every layer in AppLayer is reachable by name, and because Effect
// builds a layer value once per runtime.

const templates = new URL("../templates", import.meta.url).pathname
const run = <A, E>(eff: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.runPromise(eff.pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Path.layer)))

const everything = (database: "d1" | "postgres", auth: "better-auth" | "better-auth-orgs") =>
  withDefaults({
    name: "app",
    database,
    orm: "drizzle",
    auth,
    infra: "none",
    ai: "effect-ai-byok",
    extras: ["workflows", "realtime", "browser", "storage", "email"],
  })

it("every layer AppLayer composes is an exported constant an add-on can provide", async () => {
  for (const stack of [
    everything("d1", "better-auth"),
    everything("postgres", "better-auth-orgs"),
  ]) {
    const tree = await run(
      Effect.gen(function* () {
        return yield* generate(stack, yield* loadAddons(templates))
      }),
    )
    const layers = tree.get("apps/web/src/server/layers.ts") as string
    const names = (parseLayers(layers) ?? []).map((l) => l.name).filter((n) => n !== "Logger.layer")
    expect(names.length).toBeGreaterThan(5)
    // what each layer is built from, too: DatabaseLayer.pipe(Layer.provide(WorkerEnvLive))
    const provided = (parseLayers(layers) ?? []).flatMap((l) => l.provided)
    for (const name of [...names, ...provided, "TelemetryLive"]) {
      const exported = [...tree].filter(
        ([path, text]) =>
          /\.tsx?$/.test(path) && new RegExp(`^export const ${name}\\b`, "m").test(text),
      )
      expect(
        exported.map(([p]) => p),
        name,
      ).toHaveLength(1)
    }
  }
})

it("a layer provided by its constant is built once, shared with AppLayer", async () => {
  // the shape of DatabaseLayer.pipe(Layer.provide(WorkerEnvLive)) in AppLayer, and of an add-on's
  // layer that provides DatabaseLayer and WorkerEnvLive itself
  class Env extends Context.Service<Env, { readonly binding: string }>()("Env") {}
  class Database extends Context.Service<Database, { readonly client: number }>()("Database") {}
  class Rpc extends Context.Service<Rpc, { readonly client: number }>()("Rpc") {}
  let clients = 0
  const WorkerEnvLive = Layer.succeed(Env, { binding: "DB" })
  const DatabaseLayer = Layer.effect(
    Database,
    Effect.gen(function* () {
      yield* Env
      clients += 1
      return { client: clients }
    }),
  )
  const RpcLive = Layer.effect(
    Rpc,
    Database.useSync(({ client }) => ({ client })),
  ).pipe(Layer.provide(DatabaseLayer), Layer.provide(WorkerEnvLive))
  const AppLayer = Layer.mergeAll(DatabaseLayer.pipe(Layer.provide(WorkerEnvLive)), RpcLive)
  const runtime = ManagedRuntime.make(AppLayer)
  const [database, rpc] = await runtime.runPromise(Effect.all([Database, Rpc]))
  await runtime.dispose()
  expect(clients).toBe(1)
  expect(rpc.client).toBe(database.client)
})
