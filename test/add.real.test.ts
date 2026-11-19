import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { afterEach, beforeEach, expect, it } from "@effect/vitest"
import { Effect, type Layer } from "effect"
import { loadAddons } from "../src/addon.ts"
import { addAddons } from "../src/commands/add.ts"
import { defaultTemplatesDir } from "../src/commands/create.ts"
import { generate } from "../src/generate.ts"
import { type StackConfig, withDefaults } from "../src/stack.ts"
import { writeTree } from "../src/write.ts"

// These run against the real templates/ directory, not fixtures.

const run = <A, E>(eff: Effect.Effect<A, E, Layer.Success<typeof NodeServices.layer>>) =>
  Effect.runPromise(eff.pipe(Effect.provide(NodeServices.layer)))

const base = {
  name: "app",
  database: "postgres",
  orm: "drizzle",
  auth: "better-auth-orgs",
  infra: "none",
} as const

let tmp: string
let dir: string
beforeEach(() => {
  tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "efforge-addreal-"))
  dir = join(tmp, "app")
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const generated = (config: StackConfig) =>
  run(
    Effect.gen(function* () {
      return yield* generate(config, yield* loadAddons(defaultTemplatesDir))
    }),
  )

const snapshot = (root: string) => {
  const out = new Map<string, string>()
  const walk = (d: string, rel = "") => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel === "" ? e.name : `${rel}/${e.name}`
      if (e.isDirectory()) walk(join(d, e.name), r)
      else out.set(r, readFileSync(join(d, e.name), "utf8"))
    }
  }
  walk(root)
  return out
}

const opts = { overwrite: false, dryRun: false, install: false }

const cases: Array<[string, Partial<StackConfig>]> = [
  ["workflows", { extras: ["workflows"] }],
  ["realtime", { extras: ["realtime"] }],
  ["browser", { extras: ["browser"] }],
  ["storage", { extras: ["storage"] }],
  ["email", { extras: ["email"] }],
  ["rpc", { extras: ["rpc"] }],
  ["ai/effect-ai-byok", { ai: "effect-ai-byok" }],
  ["infra/alchemy", { infra: "alchemy" }],
]

for (const [id, change] of cases) {
  it(`add ${id} on pg+drizzle+orgs: dry-run is a no-op, then the result matches generating the full stack`, async () => {
    await run(writeTree(dir, await generated(withDefaults(base))))
    const before = snapshot(dir)

    const plan = await run(addAddons(dir, [id], { ...opts, dryRun: true }))
    expect(plan.written.length + plan.transformed.length + plan.removed.length).toBeGreaterThan(0)
    expect(snapshot(dir)).toEqual(before)

    const result = await run(addAddons(dir, [id], opts))
    expect(result.written).toEqual(plan.written)
    expect(result.transformed).toEqual(plan.transformed)
    expect(result.removed).toEqual(plan.removed)

    const expected = await generated(withDefaults({ ...base, ...change }))
    const actual = snapshot(dir)
    expect([...actual.keys()].toSorted()).toEqual([...expected.keys()].toSorted())
    for (const [file, content] of expected) {
      if (file === "efforge.jsonc") continue
      expect(actual.get(file), file).toBe(content)
    }

    // adding it again changes nothing
    const again = await run(addAddons(dir, [id], opts))
    expect(again.written).toEqual([])
    expect(again.transformed).toEqual([])
    expect(snapshot(dir)).toEqual(actual)
  })
}

it("add infra/alchemy refuses to delete an edited wrangler.jsonc unless --overwrite", async () => {
  await run(writeTree(dir, await generated(withDefaults(base))))
  const wrangler = join(dir, "wrangler.jsonc")
  const { writeFileSync, existsSync } = await import("node:fs")
  writeFileSync(wrangler, `${readFileSync(wrangler, "utf8")}\n// mine\n`)
  const e = await Effect.runPromise(
    Effect.flip(addAddons(dir, ["infra/alchemy"], opts).pipe(Effect.provide(NodeServices.layer))),
  )
  expect(e._tag).toBe("OverlayConflict")
  expect(existsSync(wrangler)).toBe(true)
  await run(addAddons(dir, ["infra/alchemy"], { ...opts, overwrite: true }))
  expect(existsSync(wrangler)).toBe(false)
})

for (const extra of ["storage", "email"] as const)
  it(`add auth after ${extra} keeps the .dev.vars entries ${extra} wrote`, async () => {
    const before = withDefaults({ ...base, auth: "none", extras: [extra] })
    await run(writeTree(dir, await generated(before)))
    await run(addAddons(dir, ["auth/better-auth"], opts))
    const devVars = readFileSync(join(dir, ".dev.vars"), "utf8")
    expect(devVars).toMatch(/^BETTER_AUTH_SECRET=/m)
    expect(devVars).toMatch(extra === "storage" ? /^STORAGE_SIGNING_SECRET=/m : /^MAIL_FROM=/m)
  })

it("add infra/alchemy after earlier adds: wrangler.jsonc they edited is not a user edit", async () => {
  // the QA repro: d1 + storage, then realtime, then alchemy
  await run(
    writeTree(dir, await generated(withDefaults({ ...base, database: "d1", extras: ["storage"] }))),
  )
  await run(addAddons(dir, ["realtime"], opts))
  await run(addAddons(dir, ["infra/alchemy"], opts))
  const { existsSync } = await import("node:fs")
  expect(existsSync(join(dir, "wrangler.jsonc"))).toBe(false)
  expect(existsSync(join(dir, "infra/alchemy.run.ts"))).toBe(true)
})

it("rpc on a project without a database, then a database and auth: the same project as created with all three", async () => {
  const minimal = {
    name: "app",
    database: "none",
    orm: "none",
    auth: "none",
    infra: "none",
  } as const
  await run(writeTree(dir, await generated(withDefaults({ ...minimal, extras: ["rpc"] }))))
  await run(addAddons(dir, ["database/d1", "orm/effect-sql"], opts))
  await run(addAddons(dir, ["auth/better-auth"], opts))
  const expected = await generated(
    withDefaults({
      ...minimal,
      database: "d1",
      orm: "effect-sql",
      auth: "better-auth",
      extras: ["rpc"],
    }),
  )
  const actual = snapshot(dir)
  for (const file of [
    "packages/core/src/rpc.ts",
    "packages/core/src/rpc-handlers.ts",
    "packages/core/src/rpc-session.ts",
    "apps/web/src/server/rpc.ts",
    "apps/web/src/lib/rpc-client.ts",
    "apps/web/src/capabilities/rpc.tsx",
    "packages/core/test/rpc.test.ts",
    "packages/core/test/rpc-session.test.ts",
    "AGENTS.md",
  ])
    expect(actual.get(file), file).toBe(expected.get(file))
  // the layers are the same; their order is the order they were added in
  const layers = (text = "") => [...text.matchAll(/^ {2}(\w+(?:\.\w+)*)[,(]/gm)].map((m) => m[1])
  const byName = (a = "", b = "") => a.localeCompare(b)
  expect(layers(actual.get("apps/web/src/server/layers.ts")).toSorted(byName)).toEqual(
    layers(expected.get("apps/web/src/server/layers.ts")).toSorted(byName),
  )
})
