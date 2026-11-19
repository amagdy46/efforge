import { type StackConfig, toCommand } from "./stack.ts"

/** A named stack: one decision instead of seven. */
export interface Preset {
  readonly id: string
  readonly title: string
  /** One line, for the prompt and `list`. */
  readonly description: string
  readonly stack: Omit<StackConfig, "name">
}

// The one place presets are defined. A preset's contents may change between versions, so nothing
// records a preset's name: the summary, `efforge.jsonc` and `--json` give the stack it chose, flag
// by flag. Each must pass the stack rules (test/presets.test.ts checks it).
export const presets: ReadonlyArray<Preset> = [
  {
    id: "saas",
    title: "SaaS",
    description: "Postgres, Drizzle, Better Auth with organizations, email and storage",
    stack: {
      runtime: "cloudflare",
      database: "postgres",
      orm: "drizzle",
      auth: "better-auth-orgs",
      infra: "none",
      ai: "none",
      extras: ["storage", "email"],
    },
  },
  {
    id: "ai",
    title: "AI",
    description: "D1, Effect SQL, Better Auth, AI with your own key, and realtime",
    stack: {
      runtime: "cloudflare",
      database: "d1",
      orm: "effect-sql",
      auth: "better-auth",
      infra: "none",
      ai: "effect-ai-byok",
      extras: ["realtime"],
    },
  },
  {
    id: "minimal",
    title: "Minimal",
    description: "No database and no auth: the app, its layers and the dashboard",
    stack: {
      runtime: "cloudflare",
      database: "none",
      orm: "none",
      auth: "none",
      infra: "none",
      ai: "none",
      extras: [],
    },
  },
]

export const presetIds: ReadonlyArray<string> = presets.map((p) => p.id)

export const presetById = (id: string): Preset | undefined => presets.find((p) => p.id === id)

/** The explicit command a preset stands for, flag by flag, for a project called `name`. */
export const presetCommand = (p: Preset, name = "my-app"): string => toCommand({ name, ...p.stack })
