import { type Preset, presetById } from "../../src/presets.ts"
import type { withDefaults } from "../../src/stack.ts"

/*
 * The stacks e2e generates, installs and gates, one CI job each (`scripts/e2e-cases.ts` reads the
 * names). `test/matrix-coverage.test.ts` holds it to every add-on on every database it allows.
 */

export const preset = (id: string) => (presetById(id) as Preset).stack

export const stacks: Array<[string, Parameters<typeof withDefaults>[0]]> = [
  // the minimal preset's stack
  [
    "minimal",
    {
      name: "minimal",
      database: "none",
      orm: "none",
      auth: "none",
      infra: "none",
      ai: "none",
      extras: [],
    },
  ],
  [
    "pg-drizzle",
    { name: "pg-drizzle", database: "postgres", orm: "drizzle", auth: "none", infra: "none" },
  ],
  ["preset-saas", { name: "preset-saas", ...preset("saas") }],
  ["preset-ai", { name: "preset-ai", ...preset("ai") }],
  [
    "d1-effect-sql",
    { name: "d1-effect-sql", database: "d1", orm: "effect-sql", auth: "none", infra: "none" },
  ],
  [
    "pg-drizzle-orgs",
    {
      name: "pg-drizzle-orgs",
      database: "postgres",
      orm: "drizzle",
      auth: "better-auth-orgs",
      infra: "none",
    },
  ],
  [
    "pg-drizzle-orgs-alchemy",
    {
      name: "pg-drizzle-orgs-alchemy",
      database: "postgres",
      orm: "drizzle",
      auth: "better-auth-orgs",
      infra: "alchemy",
    },
  ],
  [
    "pg-effect-sql-orgs",
    {
      name: "pg-effect-sql-orgs",
      database: "postgres",
      orm: "effect-sql",
      auth: "better-auth-orgs",
      infra: "none",
    },
  ],
  [
    "d1-drizzle-auth",
    {
      name: "d1-drizzle-auth",
      database: "d1",
      orm: "drizzle",
      auth: "better-auth",
      infra: "none",
      extras: ["storage", "browser"],
    },
  ],
  [
    "extras-no-db",
    {
      name: "extras-no-db",
      database: "none",
      orm: "none",
      auth: "none",
      infra: "none",
      ai: "effect-ai-byok",
      extras: ["storage", "workflows", "realtime", "browser", "email", "rpc", "cluster"],
    },
  ],
  [
    "pg-drizzle-extras",
    {
      name: "pg-drizzle-extras",
      database: "postgres",
      orm: "drizzle",
      auth: "none",
      infra: "none",
      extras: ["storage", "workflows", "realtime", "cluster"],
    },
  ],
  [
    "pg-drizzle-alchemy",
    {
      name: "pg-drizzle-alchemy",
      database: "postgres",
      orm: "drizzle",
      auth: "none",
      infra: "alchemy",
    },
  ],
  [
    "house",
    {
      name: "house",
      database: "postgres",
      orm: "drizzle",
      auth: "better-auth-orgs",
      infra: "alchemy",
      ai: "effect-ai-byok",
      extras: ["workflows", "realtime", "browser", "storage", "email"],
    },
  ],
  [
    "d1-ai-email",
    {
      name: "d1-ai-email",
      database: "d1",
      orm: "effect-sql",
      auth: "better-auth-orgs",
      infra: "none",
      ai: "effect-ai-byok",
      extras: ["email"],
    },
  ],
  [
    "d1-better-auth-alchemy-ai",
    {
      name: "d1-better-auth-alchemy-ai",
      database: "d1",
      orm: "effect-sql",
      auth: "better-auth",
      infra: "alchemy",
      ai: "effect-ai-byok",
    },
  ],
  [
    "pg-effect-sql-alchemy-email",
    {
      name: "pg-effect-sql-alchemy-email",
      database: "postgres",
      orm: "effect-sql",
      auth: "none",
      infra: "alchemy",
      extras: ["email"],
    },
  ],
  [
    "pg-drizzle-extras-alchemy",
    {
      name: "pg-drizzle-extras-alchemy",
      database: "postgres",
      orm: "drizzle",
      auth: "none",
      infra: "alchemy",
      extras: ["storage", "workflows", "realtime", "browser"],
    },
  ],
  [
    "d1-cluster-extras",
    {
      name: "d1-cluster-extras",
      database: "d1",
      orm: "effect-sql",
      auth: "better-auth",
      infra: "none",
      extras: ["workflows", "realtime", "cluster"],
    },
  ],
  [
    "pg-auth-alchemy-cluster",
    {
      name: "pg-auth-alchemy-cluster",
      database: "postgres",
      orm: "drizzle",
      auth: "better-auth",
      infra: "alchemy",
      extras: ["rpc", "cluster"],
    },
  ],
  [
    "d1-auth-alchemy-rpc",
    {
      name: "d1-auth-alchemy-rpc",
      database: "d1",
      orm: "effect-sql",
      auth: "better-auth",
      infra: "alchemy",
      extras: ["rpc"],
    },
  ],
]
