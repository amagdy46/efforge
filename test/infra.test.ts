import { NodeFileSystem } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect, Path } from "effect"
import { parse } from "jsonc-parser"
import { loadAddons } from "../src/addon.ts"
import { generate } from "../src/generate.ts"
import { type StackConfig, withDefaults } from "../src/stack.ts"
import { versions } from "../src/versions.ts"

const templates = new URL("../templates", import.meta.url).pathname

const gen = (partial: Partial<StackConfig>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* generate(
        withDefaults({ name: "app", auth: "none", ...partial }),
        yield* loadAddons(templates),
      )
    }).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Path.layer)),
  )

const text = (tree: ReadonlyMap<string, string>, file: string) => {
  const content = tree.get(file)
  if (content === undefined) throw new Error(`${file} was not generated`)
  return content
}

it("infra=alchemy: no wrangler.jsonc, Hyperdrive in alchemy.run.ts, deploy workflow", async () => {
  const tree = await gen({ database: "postgres", orm: "drizzle", infra: "alchemy" })
  expect(tree.has("wrangler.jsonc")).toBe(false)
  const run = text(tree, "infra/alchemy.run.ts")
  expect(run).toContain("Cloudflare.Hyperdrive.Connection")
  expect(run).toContain("HYPERDRIVE: hyperdrive")
  expect(run).toContain("Cloudflare.Website.Vite")
  expect(run).toContain("// efforge:resources")
  // DATABASE_URL is read as a secret, never a plain string
  expect(run).toContain('Config.Redacted("DATABASE_URL")')
  const deploy = text(tree, ".github/workflows/deploy.yml")
  for (const s of [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "ALCHEMY_PASSWORD",
    "DATABASE_URL",
  ])
    expect(deploy).toContain(`secrets.${s}`)
  expect(deploy).toContain("format('pr-{0}', github.event.number)")
  expect(deploy).toContain("types: [opened, synchronize, reopened, closed]")
})

it("infra=alchemy: the Worker entry is server.ts and vite.config.ts does not use wrangler", async () => {
  const tree = await gen({ database: "postgres", orm: "drizzle", infra: "alchemy" })
  const vite = text(tree, "apps/web/vite.config.ts")
  expect(vite).not.toContain("configPath:")
  expect(vite).not.toContain("../../wrangler.jsonc")
  expect(vite).toContain("ALCHEMY_CLOUDFLARE_VITE_INJECTED")
  expect(text(tree, "infra/alchemy.run.ts")).toContain('main: "src/server.ts"')
  const root = JSON.parse(text(tree, "package.json"))
  expect(root.scripts.dev).toContain("alchemy dev")
  expect(root.scripts.deploy).toContain("alchemy deploy")
  expect(root.scripts.destroy).toContain("alchemy destroy")
  expect(root.devDependencies.alchemy).toBe("catalog:")
  expect(text(tree, "pnpm-workspace.yaml")).toContain(`alchemy: ${versions.alchemy}`)
})

it("infra=none: wrangler.jsonc has the hyperdrive binding and there is no alchemy", async () => {
  const tree = await gen({ database: "postgres", orm: "drizzle", infra: "none" })
  expect(parse(text(tree, "wrangler.jsonc")).hyperdrive).toEqual([
    expect.objectContaining({ binding: "HYPERDRIVE" }),
  ])
  expect(tree.has("infra/alchemy.run.ts")).toBe(false)
  expect(tree.has(".github/workflows/deploy.yml")).toBe(false)
  expect(text(tree, "apps/web/vite.config.ts")).toContain("wrangler.jsonc")
  expect(JSON.parse(text(tree, "package.json")).scripts.dev).toBe("turbo run dev")
})

it("infra=alchemy: d1 lands as a D1 database with the ORM's migrations directory", async () => {
  const drizzle = text(
    await gen({ database: "d1", orm: "drizzle", infra: "alchemy" }),
    "infra/alchemy.run.ts",
  )
  expect(drizzle).toContain("Cloudflare.D1.Database")
  expect(drizzle).toContain("DB: database")
  expect(drizzle).toContain('migrations: "packages/db/drizzle"')
  expect(drizzle).not.toContain("Hyperdrive")
  const sql = text(
    await gen({ database: "d1", orm: "effect-sql", infra: "alchemy" }),
    "infra/alchemy.run.ts",
  )
  expect(sql).toContain('migrations: "packages/db/migrations"')
})

it("infra=alchemy: each extra's resource lands in alchemy.run.ts under its binding name", async () => {
  const none = text(
    await gen({ database: "none", orm: "none", infra: "alchemy" }),
    "infra/alchemy.run.ts",
  )
  for (const s of ["R2", "Workflow", "DurableObject", "Container", "Hyperdrive", "D1"])
    expect(none).not.toContain(`Cloudflare.${s}`)

  const cases: Array<[StackConfig["extras"][number], string[]]> = [
    ["storage", ["STORAGE: storage", "Cloudflare.R2.Bucket", "STORAGE_SIGNING_SECRET"]],
    ["realtime", ["ROOM: room", 'Cloudflare.DurableObject("Room")']],
    ["workflows", ["EXAMPLE_WORKFLOW: exampleWorkflow", 'Cloudflare.Workflow("Example"']],
    ["browser", ["BROWSER: browser", 'className: "BrowserContainer"', 'context: "apps/browser"']],
  ]
  for (const [extra, expected] of cases) {
    const run = text(
      await gen({ database: "none", orm: "none", infra: "alchemy", extras: [extra] }),
      "infra/alchemy.run.ts",
    )
    for (const s of expected) expect(run).toContain(s)
  }

  const all = text(
    await gen({
      database: "none",
      orm: "none",
      infra: "alchemy",
      extras: ["storage", "workflows", "realtime", "browser"],
    }),
    "infra/alchemy.run.ts",
  )
  expect(all.match(/STORAGE: storage/g)).toHaveLength(1)
  expect(all.indexOf("// efforge:resources")).toBeGreaterThan(all.indexOf("const browser"))
  expect(all.indexOf("const browser")).toBeLessThan(all.indexOf("Cloudflare.Website.Vite"))
})
