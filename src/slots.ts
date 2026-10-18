import type { SlotId, StackConfig } from "./stack.ts"

export interface OptionDef {
  readonly id: string
  readonly label: string
  readonly hint?: string
  readonly slot: SlotId
}

export interface SlotDef {
  readonly id: SlotId
  readonly title: string
  readonly section: "Platform" | "Data" | "Features"
  readonly multi: boolean
  readonly default: string | string[]
  readonly options: OptionDef[]
}

const opt = (slot: SlotId, id: string, label: string, hint?: string): OptionDef =>
  hint === undefined ? { id, label, slot } : { id, label, hint, slot }

export const slots: ReadonlyArray<SlotDef> = [
  {
    id: "runtime",
    title: "Runtime",
    section: "Platform",
    multi: false,
    default: "cloudflare",
    options: [opt("runtime", "cloudflare", "Cloudflare Workers")],
  },
  {
    id: "database",
    title: "Database",
    section: "Data",
    multi: false,
    default: "postgres",
    options: [
      opt("database", "postgres", "Postgres", "via Hyperdrive"),
      opt("database", "d1", "Cloudflare D1", "SQLite at the edge"),
      opt("database", "none", "None"),
    ],
  },
  {
    id: "orm",
    title: "ORM",
    section: "Data",
    multi: false,
    default: "drizzle",
    options: [
      opt("orm", "drizzle", "Drizzle"),
      opt("orm", "effect-sql", "Effect SQL", "@effect/sql"),
      opt("orm", "none", "None"),
    ],
  },
  {
    id: "auth",
    title: "Auth",
    section: "Data",
    multi: false,
    default: "better-auth-orgs",
    options: [
      opt("auth", "better-auth-orgs", "Better Auth + organizations"),
      opt("auth", "better-auth", "Better Auth"),
      opt("auth", "none", "None"),
    ],
  },
  {
    id: "infra",
    title: "Infrastructure as code",
    section: "Platform",
    multi: false,
    default: "none",
    options: [opt("infra", "none", "None", "wrangler.jsonc"), opt("infra", "alchemy", "Alchemy")],
  },
  {
    id: "ai",
    title: "AI",
    section: "Features",
    multi: false,
    default: "none",
    options: [
      opt("ai", "none", "None"),
      opt("ai", "effect-ai-byok", "Effect AI (bring your own key)"),
    ],
  },
  {
    id: "extras",
    title: "Extras",
    section: "Features",
    multi: true,
    default: [],
    options: [
      opt("extras", "workflows", "Workflows"),
      opt("extras", "realtime", "Realtime"),
      opt("extras", "browser", "Browser rendering"),
      opt("extras", "storage", "Storage"),
      opt("extras", "email", "Email"),
    ],
  },
]

const cloudflareOnly = new Set(["d1", "workflows", "realtime", "browser"])

/** Options of `slot` that are compatible with the choices already made in `partial`. */
export const available = (
  slot: SlotId,
  partial: Partial<StackConfig>,
): ReadonlyArray<OptionDef> => {
  const options = slots.find((s) => s.id === slot)?.options ?? []
  return options.filter((o) => {
    if (
      cloudflareOnly.has(o.id) &&
      partial.runtime !== undefined &&
      partial.runtime !== "cloudflare"
    )
      return false
    if (slot === "orm")
      return (partial.database === "none") === (o.id === "none") || partial.database === undefined
    if (slot === "auth") return partial.database !== "none" || o.id === "none"
    return true
  })
}
