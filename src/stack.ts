import { Schema } from "effect"
import { available, slots } from "./slots.ts"

export const Runtime = Schema.Literals(["cloudflare"])
export const Database = Schema.Literals(["postgres", "d1", "none"])
export const Orm = Schema.Literals(["drizzle", "effect-sql", "none"])
export const Auth = Schema.Literals(["better-auth-orgs", "better-auth", "none"])
export const Infra = Schema.Literals(["none", "alchemy"])
export const Ai = Schema.Literals(["none", "effect-ai-byok"])
export const Extra = Schema.Literals(["workflows", "realtime", "browser", "storage", "email"])

export const SlotId = Schema.Literals([
  "runtime",
  "database",
  "orm",
  "auth",
  "infra",
  "ai",
  "extras",
])
export type SlotId = typeof SlotId.Type

/** npm package name pattern, no `..` segments. */
export const ProjectName = Schema.String.check(
  Schema.isPattern(/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/),
  Schema.makeFilter((s: string) => !s.includes("..") || "must not contain '..'"),
)

export const StackConfig = Schema.Struct({
  name: ProjectName,
  runtime: Runtime,
  database: Database,
  orm: Orm,
  auth: Auth,
  infra: Infra,
  ai: Ai,
  extras: Schema.Array(Extra),
})
export type StackConfig = typeof StackConfig.Type

type Draft = { -readonly [K in keyof StackConfig]?: StackConfig[K] | undefined }

/** Default for a slot given the choices made so far: the slot default if available, else the first available option. */
const pick = (slot: Exclude<SlotId, "extras">, so_far: Draft): string => {
  const def = slots.find((s) => s.id === slot)
  const options = available(slot, so_far)
  const wanted = def?.default as string
  return options.some((o) => o.id === wanted) ? wanted : (options[0]?.id ?? wanted)
}

export const withDefaults = (partial: Partial<StackConfig> & { name: string }): StackConfig => {
  const out: Draft = { name: partial.name }
  for (const slot of slots) {
    if (slot.id === "extras") {
      out.extras = partial.extras ?? []
    } else {
      ;(out as Record<string, unknown>)[slot.id] = partial[slot.id] ?? pick(slot.id, out)
    }
  }
  return out as StackConfig
}

/** `npm create efforge <name> -- --slot=value ...`, omitting values that equal what defaults would pick. */
export const toCommand = (config: StackConfig): string => {
  const flags: string[] = []
  const so_far: Draft = { name: config.name }
  for (const slot of slots) {
    if (slot.id === "extras") {
      if (config.extras.length > 0) flags.push(`--extras=${config.extras.join(",")}`)
    } else {
      const value = config[slot.id]
      if (value !== pick(slot.id, so_far)) flags.push(`--${slot.id}=${value}`)
      ;(so_far as Record<string, unknown>)[slot.id] = value
    }
  }
  return ["npm create efforge", config.name, ...(flags.length > 0 ? ["--", ...flags] : [])].join(
    " ",
  )
}
