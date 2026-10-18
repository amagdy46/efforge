import { NodeFileSystem } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect, Path } from "effect"
import { loadAddons } from "../src/addon.ts"
import { generate } from "../src/generate.ts"
import { type StackConfig, withDefaults } from "../src/stack.ts"

const templates = new URL("../templates", import.meta.url).pathname

const gen = (partial: Partial<StackConfig>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* generate(
        withDefaults({ name: "app", infra: "none", ...partial }),
        yield* loadAddons(templates),
      )
    }).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Path.layer)),
  )

const text = (tree: ReadonlyMap<string, string>, file: string) => {
  const content = tree.get(file)
  if (content === undefined) throw new Error(`${file} was not generated`)
  return content
}

const combos = [
  ["postgres", "drizzle"],
  ["postgres", "effect-sql"],
  ["d1", "drizzle"],
  ["d1", "effect-sql"],
] as const
const auths = ["better-auth", "better-auth-orgs"] as const

it("every auth x database x orm combination generates the server, UI and schema", async () => {
  for (const [database, orm] of combos)
    for (const auth of auths) {
      const tree = await gen({ database, orm, auth })
      const where = `${auth}/${database}/${orm}`
      for (const file of [
        "packages/core/src/Auth.ts",
        "apps/web/src/server/auth.ts",
        "apps/web/src/server/auth-database.ts",
        "apps/web/src/server/auth-live.ts",
        "apps/web/src/server/auth-route.ts",
        "apps/web/src/server/session.ts",
        "apps/web/src/lib/auth-client.ts",
        "apps/web/src/routes/sign-in.tsx",
        "apps/web/src/routes/sign-up.tsx",
        "apps/web/src/routes/app.tsx",
        ".dev.vars",
      ])
        expect(tree.has(file), `${where}: ${file}`).toBe(true)
      expect(tree.has("apps/web/src/routeTree.gen.ts"), where).toBe(false)
      // the notes list on /app survives the dashboard overlay
      expect(text(tree, "apps/web/src/routes/app/index.tsx"), where).toContain("listNotes")
      const layers = text(tree, "apps/web/src/server/layers.ts")
      expect(layers, where).toContain("AuthLive")
      expect(text(tree, "apps/web/src/server/routes.ts"), where).toContain("authRoute")
      expect(text(tree, ".env.example"), where).toContain("BETTER_AUTH_SECRET=")
      expect(text(tree, ".env.example"), where).toContain("BETTER_AUTH_URL=")
      expect(text(tree, "packages/core/src/index.ts"), where).toContain("./Auth")
      const hasOrgs = auth === "better-auth-orgs"
      const authTs = text(tree, "apps/web/src/server/auth.ts")
      expect(authTs.includes("organization()"), where).toBe(hasOrgs)
      expect(tree.has("apps/web/src/routes/app/settings/members.tsx"), where).toBe(hasOrgs)
      expect(tree.has("apps/web/src/routes/accept-invite.$id.tsx"), where).toBe(hasOrgs)
      expect(tree.has("apps/web/src/routes/onboarding.tsx"), where).toBe(hasOrgs)
      if (orm === "drizzle") {
        const schema = text(tree, "packages/db/src/auth-schema.ts")
        expect(schema.includes("export const organization"), where).toBe(hasOrgs)
        expect(text(tree, "packages/db/src/index.ts"), where).toContain("./auth-schema")
        expect(text(tree, "packages/db/drizzle.config.ts"), where).toContain("auth-schema")
      } else {
        const sql = text(tree, "packages/db/migrations/0002_auth.sql")
        expect(sql.includes('create table "organization"'), where).toBe(hasOrgs)
      }
    }
})

it("the orgs variant adds the organization plugin through the plugins seam", async () => {
  const tree = await gen({ database: "postgres", orm: "drizzle", auth: "better-auth-orgs" })
  const auth = text(tree, "apps/web/src/server/auth.ts")
  expect(auth).toContain('import { organization } from "better-auth/plugins"')
  expect(auth).toMatch(/plugins: \[[^\]]*organization\(\)/)
  expect(auth).not.toContain("sendInvitationEmail")
  // the anchor stays so later add-ons can append their own plugins
  expect(auth).toContain("efforge:auth-plugins")
})

it("the better-auth variant leaves the plugins list empty", async () => {
  const tree = await gen({ database: "postgres", orm: "drizzle", auth: "better-auth" })
  expect(text(tree, "apps/web/src/server/auth.ts")).toContain(
    "plugins: [/* efforge:auth-plugins */]",
  )
  expect(tree.has("packages/db/src/auth-schema.ts")).toBe(true)
})

it("better-auth gets its database per stack", async () => {
  const pgDrizzle = text(
    await gen({ database: "postgres", orm: "drizzle", auth: "better-auth" }),
    "apps/web/src/server/auth-database.ts",
  )
  expect(pgDrizzle).toContain("drizzle-orm/node-postgres")
  expect(pgDrizzle).toContain('provider: "pg"')
  const pgSql = text(
    await gen({ database: "postgres", orm: "effect-sql", auth: "better-auth" }),
    "apps/web/src/server/auth-database.ts",
  )
  expect(pgSql).toContain("new Pool(")
  const d1Drizzle = text(
    await gen({ database: "d1", orm: "drizzle", auth: "better-auth" }),
    "apps/web/src/server/auth-database.ts",
  )
  expect(d1Drizzle).toContain("drizzle-orm/d1")
  expect(d1Drizzle).toContain('provider: "sqlite"')
})

it("pins better-auth and the pg driver in the catalog", async () => {
  const tree = await gen({ database: "postgres", orm: "drizzle", auth: "better-auth-orgs" })
  expect(text(tree, "pnpm-workspace.yaml")).toContain("better-auth: 1.7.10")
  expect(JSON.parse(text(tree, "apps/web/package.json")).dependencies["better-auth"]).toBe(
    "catalog:",
  )
})

it.each(auths)(
  "%s with infra=alchemy binds its secret and URL and exposes the secret to CI",
  async (auth) => {
    const tree = await gen({ database: "postgres", orm: "drizzle", auth, infra: "alchemy" })
    const run = text(tree, "infra/alchemy.run.ts")
    expect(run).toContain('Config.Redacted("BETTER_AUTH_SECRET")')
    expect(run).toMatch(/BETTER_AUTH_SECRET: betterAuthSecret/)
    expect(run).toContain('Config.String("BETTER_AUTH_URL")')
    expect(run).toMatch(/BETTER_AUTH_URL: betterAuthUrl/)
    // the secret is read as Redacted, never a plain string
    expect(run).not.toContain("BETTER_AUTH_SECRET: process.env")
    const deploy = text(tree, ".github/workflows/deploy.yml")
    expect(deploy).toContain(`BETTER_AUTH_SECRET: \${{ secrets.BETTER_AUTH_SECRET }}`)
    expect(deploy.match(/BETTER_AUTH_SECRET:/g)).toHaveLength(1)
  },
)

it("without alchemy, auth adds no infra file and no workflow secret", async () => {
  const tree = await gen({
    database: "postgres",
    orm: "drizzle",
    auth: "better-auth",
    infra: "none",
  })
  expect(tree.has("infra/alchemy.run.ts")).toBe(false)
  expect(tree.has(".github/workflows/deploy.yml")).toBe(false)
})

it.each(auths)("%s documents itself in AGENTS.md", async (auth) => {
  const agents = text(await gen({ database: "postgres", orm: "drizzle", auth }), "AGENTS.md")
  expect(agents).toContain("## Auth (Better Auth)")
  expect(agents.includes("## Organizations")).toBe(auth === "better-auth-orgs")
  expect(agents.indexOf("## Auth (Better Auth)")).toBeLessThan(
    agents.indexOf("<!-- efforge:agents -->"),
  )
})
