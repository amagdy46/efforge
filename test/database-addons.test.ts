import { NodeFileSystem } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect, Path } from "effect"
import { parse } from "jsonc-parser"
import { loadAddons } from "../src/addon.ts"
import { generate } from "../src/generate.ts"
import { type StackConfig, withDefaults } from "../src/stack.ts"

const templates = new URL("../templates", import.meta.url).pathname

const gen = (partial: Partial<StackConfig>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* generate(
        withDefaults({ name: "app", auth: "none", infra: "none", ...partial }),
        yield* loadAddons(templates),
      )
    }).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Path.layer)),
  )

const text = (tree: ReadonlyMap<string, string>, file: string) => {
  const content = tree.get(file)
  if (content === undefined) throw new Error(`${file} was not generated`)
  return content
}
const json = (tree: ReadonlyMap<string, string>, file: string) => JSON.parse(text(tree, file))

it("postgres + drizzle: Hyperdrive binding, compose file, drizzle layer", async () => {
  const tree = await gen({ database: "postgres", orm: "drizzle" })
  const wrangler = parse(text(tree, "wrangler.jsonc"))
  expect(wrangler.hyperdrive).toEqual([
    expect.objectContaining({
      binding: "HYPERDRIVE",
      localConnectionString: "postgres://postgres:postgres@localhost:5432/app",
    }),
  ])
  expect(wrangler.d1_databases).toBeUndefined()
  expect(text(tree, "docker-compose.yml")).toContain("image: postgres:17")
  expect(text(tree, "packages/db/src/layer.ts")).toContain("drizzle-orm/effect-postgres")
  expect(text(tree, "packages/core/src/Database.ts")).toContain("Context.Service")
  expect(tree.has("packages/db/drizzle.config.ts")).toBe(true)
  expect(text(tree, ".env.example")).toContain("DATABASE_URL=postgres://")
  expect(text(tree, "apps/web/src/server/runtime.ts")).toContain("Effect.provide(effect, AppLayer)")
})

it("registers the database layer in AppLayer, providing the Worker env", async () => {
  const layers = text(
    await gen({ database: "postgres", orm: "drizzle" }),
    "apps/web/src/server/layers.ts",
  )
  expect(layers).toContain('import { WorkerEnvLive } from "./cloudflare"')
  expect(layers).toContain('import { DatabaseLayer } from "@repo/db"')
  expect(layers).toContain("DatabaseLayer.pipe(Layer.provide(WorkerEnvLive))")
  expect(layers.indexOf("@repo/db")).toBeLessThan(layers.indexOf("effect"))
})

it("d1 + effect-sql: D1 binding, SQL migration, no drizzle and no compose file", async () => {
  const tree = await gen({ database: "d1", orm: "effect-sql" })
  const wrangler = parse(text(tree, "wrangler.jsonc"))
  expect(wrangler.d1_databases).toEqual([
    expect.objectContaining({ binding: "DB", migrations_dir: "packages/db/migrations" }),
  ])
  expect(wrangler.hyperdrive).toBeUndefined()
  expect(tree.has("docker-compose.yml")).toBe(false)
  expect(text(tree, "packages/db/migrations/0001_init.sql")).toContain("CREATE TABLE note")
  expect(text(tree, "packages/db/src/layer.ts")).toContain("sqlLayer")
  const deps = json(tree, "packages/db/package.json")
  expect(Object.keys(deps.dependencies)).not.toContain("drizzle-orm")
  expect(deps.dependencies["@repo/core"]).toBe("workspace:*")
  expect(text(tree, "apps/web/src/server/runtime.ts")).toContain("ManagedRuntime")
})

it("every combination wires db:migrate at the root and in @repo/db, and lists notes on /app", async () => {
  for (const database of ["postgres", "d1"] as const)
    for (const orm of ["drizzle", "effect-sql"] as const) {
      const tree = await gen({ database, orm })
      expect(json(tree, "package.json").scripts["db:migrate"]).toBe(
        "pnpm --filter @repo/db db:migrate",
      )
      expect(json(tree, "packages/db/package.json").scripts["db:migrate"]).toBe(
        "node scripts/migrate.ts",
      )
      expect(json(tree, "apps/web/package.json").dependencies["@repo/db"]).toBe("workspace:*")
      expect(text(tree, "apps/web/src/server/notes.ts")).toContain("listNotes")
      expect(text(tree, "apps/web/src/routes/app/index.tsx")).toContain("listNotes()")
    }
})

it("no database means no packages/db", async () => {
  const tree = await gen({ database: "none", orm: "none" })
  expect([...tree.keys()].some((f) => f.startsWith("packages/db/"))).toBe(false)
  expect(text(tree, "apps/web/src/server/layers.ts")).not.toContain("DatabaseLayer")
})
