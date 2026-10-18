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

const orgs = { database: "postgres", orm: "drizzle", auth: "better-auth-orgs" } as const

it("ai + orgs: encrypted per-org credentials for every orm x database", async () => {
  for (const [database, orm] of [
    ["postgres", "drizzle"],
    ["postgres", "effect-sql"],
    ["d1", "drizzle"],
    ["d1", "effect-sql"],
  ] as const) {
    const tree = await gen({ database, orm, auth: "better-auth-orgs", ai: "effect-ai-byok" })
    const where = `${database}/${orm}`
    for (const file of [
      "packages/core/src/llm.ts",
      "packages/core/src/llm-crypto.ts",
      "packages/core/src/llm-store.ts",
      "apps/web/src/server/llm.ts",
      "apps/web/src/server/llm-store.ts",
      "apps/web/src/server/llm-provider.ts",
      "apps/web/src/server/ai-settings.ts",
      "apps/web/src/routes/app/settings/ai.tsx",
    ])
      expect(tree.has(file), `${where} ${file}`).toBe(true)
    expect(text(tree, "apps/web/src/server/llm.ts"), where).toContain("LlmCredentials")
    expect(text(tree, "apps/web/src/routes/app/settings.tsx"), where).toContain("/app/settings/ai")
    expect(text(tree, ".dev.vars"), where).toMatch(/^LLM_ENCRYPTION_KEY=/m)
    const migration = [...tree.keys()].filter((f) => /llm_credential/.test(f))
    expect(migration.length, where).toBeGreaterThan(0)
  }
})

it("ai without orgs: key from the environment, no credential table or settings page", async () => {
  for (const auth of ["none", "better-auth"] as const) {
    const tree = await gen(
      auth === "none"
        ? { database: "none", orm: "none", auth, ai: "effect-ai-byok" }
        : { database: "postgres", orm: "drizzle", auth, ai: "effect-ai-byok" },
    )
    expect(text(tree, "apps/web/src/server/llm.ts"), auth).toContain("LLM_PROVIDER")
    expect(tree.has("apps/web/src/server/ai-settings.ts"), auth).toBe(false)
    expect(tree.has("packages/core/src/llm-crypto.ts"), auth).toBe(false)
    expect(text(tree, ".env.example"), auth).toContain("LLM_API_KEY=")
    expect(text(tree, ".env.example"), auth).not.toContain("LLM_ENCRYPTION_KEY")
  }
})

it("server functions are gated behind requireSession exactly when auth is present", async () => {
  const gated = ["run-browser", "example-job", "ai"]
  const withAuth = await gen({ ...orgs, ai: "effect-ai-byok", extras: ["browser", "workflows"] })
  for (const file of gated) {
    const body = text(withAuth, `apps/web/src/server/${file}.ts`)
    expect(body, file).toContain(".middleware([requireSession])")
    expect(body, file).toContain('from "./require-session"')
  }
  const without = await gen({
    database: "none",
    orm: "none",
    auth: "none",
    ai: "effect-ai-byok",
    extras: ["browser", "workflows"],
  })
  for (const file of gated)
    expect(text(without, `apps/web/src/server/${file}.ts`), file).not.toContain(".middleware(")
})

it("email: Mailer layer, console transport in dev, wrangler binding; invitations with orgs", async () => {
  const tree = await gen({ ...orgs, extras: ["email"] })
  expect(text(tree, "apps/web/src/server/layers.ts")).toContain("MailerLive")
  expect(text(tree, ".dev.vars")).toContain("MAIL_TRANSPORT=console")
  expect(text(tree, "wrangler.jsonc")).toContain('"send_email"')
  expect(text(tree, "apps/web/src/server/auth.ts")).toContain(
    "organization({ sendInvitationEmail })",
  )
  expect(tree.has("apps/web/src/server/invitation-email.ts")).toBe(true)

  const plain = await gen({ database: "none", orm: "none", auth: "none", extras: ["email"] })
  expect(plain.has("apps/web/src/server/invitation-email.ts")).toBe(false)
  expect(text(plain, "apps/web/src/server/layers.ts")).toContain("MailerLive")
})

it("alchemy: AI secrets, the email binding and workflow secrets are wired", async () => {
  const tree = await gen({ ...orgs, infra: "alchemy", ai: "effect-ai-byok", extras: ["email"] })
  const run = text(tree, "infra/alchemy.run.ts")
  for (const needle of ["LLM_ENCRYPTION_KEY", "Cloudflare.Email.SendEmail", "EMAIL: email"])
    expect(run).toContain(needle)
  const deploy = text(tree, ".github/workflows/deploy.yml")
  for (const name of ["LLM_ENCRYPTION_KEY", "MAIL_FROM"]) expect(deploy).toContain(name)
  expect(tree.has("wrangler.jsonc")).toBe(false)

  const env = await gen({
    database: "none",
    orm: "none",
    auth: "none",
    infra: "alchemy",
    ai: "effect-ai-byok",
  })
  expect(text(env, ".github/workflows/deploy.yml")).toContain("LLM_API_KEY")
})
