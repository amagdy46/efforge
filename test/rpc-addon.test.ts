import { NodeServices } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect, type Layer } from "effect"
import { loadAddons } from "../src/addon.ts"
import { REGISTRY_FILE } from "../src/cards.ts"
import { describeAddon } from "../src/commands/info.ts"
import { generate } from "../src/generate.ts"
import { type StackConfig, withDefaults } from "../src/stack.ts"

// The rpc add-on's files differ by stack (a database adds ListNotes, auth adds the session rule),
// its card module included: each variant must still be registered on the stacks it is for.

const templates = new URL("../templates", import.meta.url).pathname

const run = <A, E>(eff: Effect.Effect<A, E, Layer.Success<typeof NodeServices.layer>>) =>
  Effect.runPromise(eff.pipe(Effect.provide(NodeServices.layer)))

const generated = (config: Partial<StackConfig>) =>
  run(
    Effect.gen(function* () {
      const addons = yield* loadAddons(templates)
      return yield* generate(withDefaults({ name: "app", extras: ["rpc"], ...config }), addons)
    }),
  )

const stacks: Array<[string, Partial<StackConfig>]> = [
  ["no database", { database: "none", orm: "none", auth: "none" }],
  ["d1 without auth", { database: "d1", orm: "effect-sql", auth: "none" }],
  ["postgres with organizations", { database: "postgres", orm: "drizzle" }],
]

for (const [name, config] of stacks)
  it(`rpc on ${name}: the card is registered, and the group fits the stack`, async () => {
    const tree = await generated(config)
    expect(tree.get(REGISTRY_FILE)).toMatch(/import \{ rpc \} from "\.\/rpc"/)
    expect(tree.get(REGISTRY_FILE)).toMatch(/\brpc \/\* efforge:capabilities \*\//)
    const database = config.database !== "none"
    const auth = config.auth !== "none"
    expect(tree.get("packages/core/src/rpc.ts")?.includes('"ListNotes"')).toBe(database)
    expect(tree.get("apps/web/src/capabilities/rpc.tsx")?.includes('"ListNotes"')).toBe(database)
    expect(tree.has("packages/core/src/rpc-session.ts")).toBe(auth)
    expect(tree.get("apps/web/src/server/rpc.ts")?.includes("SessionRpcs")).toBe(auth)
    expect(tree.get("apps/web/src/lib/rpc-client.ts")?.includes("RpcSessionClient")).toBe(auth)
    expect(tree.get("apps/web/src/server/layers.ts")).toMatch(/^ {2}RpcLive,$/m)
    // with auth, /api/rpc is under the route gate and stays off its public list
    if (auth) expect(tree.get("apps/web/src/server/public-api-paths.json")).not.toMatch(/rpc/)
  })

it("info shows the rpc card for every stack, its two variants as one", async () => {
  const addons = await run(loadAddons(templates))
  const rpc = addons.get("extras/rpc")?.manifest
  if (rpc === undefined) throw new Error("extras/rpc is not loaded")
  expect(describeAddon(rpc).card).toEqual({
    module: "apps/web/src/capabilities/rpc.tsx",
    export: "rpc",
  })
})
