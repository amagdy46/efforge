/** The choices this project was created with, as `efforge.jsonc` records them (`efforge add` updates it). */
export interface Stack {
  readonly runtime: string
  readonly database: string
  readonly orm: string
  readonly auth: string
  readonly infra: string
  readonly ai: string
  readonly extras: ReadonlyArray<string>
}

export interface StackItem {
  /** The slot, e.g. "Database" */
  readonly slot: string
  /** What was chosen, or undefined for none */
  readonly label: string | undefined
  /** The file to open first */
  readonly path: string | undefined
  /** The dashboard card that shows it working */
  readonly card: string | undefined
}

const runtimes: Record<string, string> = { cloudflare: "Cloudflare Workers" }
const databases: Record<string, string> = {
  postgres: "Postgres via Hyperdrive",
  d1: "Cloudflare D1",
}
const orms: Record<string, string> = { drizzle: "Drizzle", "effect-sql": "Effect SQL" }
const auths: Record<string, string> = {
  "better-auth": "Better Auth",
  "better-auth-orgs": "Better Auth with organizations",
}
const ais: Record<string, string> = { "effect-ai-byok": "Effect AI, bring your own key" }
const extras: Record<string, { label: string; path: string }> = {
  workflows: { label: "Workflows", path: "packages/core/src/jobs.ts" },
  realtime: { label: "Realtime", path: "packages/core/src/realtime.ts" },
  browser: { label: "Browser rendering", path: "packages/core/src/browser.ts" },
  storage: { label: "Storage", path: "packages/core/src/storage.ts" },
  email: { label: "Email", path: "packages/core/src/mailer.ts" },
}

const chosen = (value: string) => value !== "none"

/** The stack as rows for the landing page; `cards` are the ids the dashboard has a card for. */
export const stackItems = (stack: Stack, cards: ReadonlyArray<string>): StackItem[] => {
  const card = (id: string) => (cards.includes(id) ? id : undefined)
  const row = (
    slot: string,
    value: string,
    labels: Record<string, string>,
    path: string,
    cardId: string,
  ): StackItem =>
    chosen(value)
      ? { slot, label: labels[value] ?? value, path, card: card(cardId) }
      : { slot, label: undefined, path: undefined, card: undefined }
  return [
    row("Runtime", stack.runtime, runtimes, "apps/web/src/server/layers.ts", "runtime"),
    row("Database", stack.database, databases, "packages/db/src/layer.ts", "database"),
    row("ORM", stack.orm, orms, "packages/db/src/schema.ts", "database"),
    row("Auth", stack.auth, auths, "packages/core/src/Auth.ts", "auth"),
    stack.infra === "alchemy"
      ? { slot: "Infra", label: "Alchemy", path: "infra/alchemy.run.ts", card: undefined }
      : { slot: "Infra", label: "Wrangler", path: "wrangler.jsonc", card: undefined },
    row("AI", stack.ai, ais, "packages/core/src/llm.ts", "ai"),
    ...(stack.extras.length === 0
      ? [{ slot: "Extras", label: undefined, path: undefined, card: undefined }]
      : stack.extras.map((id) => ({
          slot: "Extra",
          label: extras[id]?.label ?? id,
          path: extras[id]?.path,
          card: card(id),
        }))),
  ]
}

const suggestions = ["email", "storage", "realtime", "workflows", "ai/effect-ai-byok", "browser"]

/** The `add` command for one capability this project does not have yet. */
export const nextAdd = (stack: Stack): string => {
  const missing = suggestions.find((id) =>
    id.startsWith("ai/") ? stack.ai === "none" : !stack.extras.includes(id),
  )
  return missing === undefined ? "npx create-efforge list" : `npx create-efforge add ${missing}`
}

/** One plain sentence on what the project is made of. */
export const describeStack = (stack: Stack): string => {
  const parts = [`a TanStack Start app on ${runtimes[stack.runtime] ?? stack.runtime}`]
  if (stack.database !== "none")
    parts.push(
      `with ${databases[stack.database] ?? stack.database} through ${orms[stack.orm] ?? stack.orm}`,
    )
  if (stack.auth !== "none") parts.push(`and ${auths[stack.auth] ?? stack.auth} sign-in`)
  return `${parts.join(" ")}.`
}
