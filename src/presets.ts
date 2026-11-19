import { type StackConfig, toCommand } from "./stack.ts"

/** A named stack: one decision instead of seven. */
export interface Preset {
  readonly id: string
  readonly title: string
  /** One line, for the prompt and `list`: at most 47 characters, so the prompt fits 80 columns. */
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
    description: "Postgres, Drizzle, auth + orgs, email, storage",
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
    description: "D1, Effect SQL, auth, AI (your key), realtime",
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
    description: "No database or auth: the app and its dashboard",
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
