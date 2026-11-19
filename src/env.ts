import type { AddonManifest, LoadedAddon } from "./addon.ts"
import { addonIdsFor } from "./addon.ts"
import { matches } from "./generate.ts"
import type { StackConfig } from "./stack.ts"

/**
 * Local settings. A stack has one file `pnpm dev` reads them from: `.dev.vars` (wrangler and the
 * Cloudflare Vite plugin) or `.env` (`alchemy dev`). efforge writes it at `create` and at every
 * `add`, with the value that works locally for each variable (`dev` in addon.json), and an empty
 * one for a real secret. `.env.example` holds the same lines, committed, so a fresh clone copies it.
 */
export const ENV_EXAMPLE = ".env.example"
export const DEV_VARS = ".dev.vars"
export const DOT_ENV = ".env"

export const localEnvFile = (stack: StackConfig): string =>
  stack.infra === "alchemy" ? DOT_ENV : DEV_VARS

export type EnvVarDecl = AddonManifest["envVars"][number]

export interface EnvGroup {
  readonly id: string
  readonly title: string
  readonly vars: ReadonlyArray<EnvVarDecl>
}

/** The env vars of `stack`, grouped by add-on in generate order, each name once. */
export const envGroups = (
  stack: StackConfig,
  addons: ReadonlyMap<string, LoadedAddon>,
  skip: ReadonlySet<string> = new Set(),
): EnvGroup[] => {
  const seen = new Set(skip)
  const out: EnvGroup[] = []
  for (const id of addonIdsFor(stack)) {
    const m = addons.get(id)?.manifest
    if (m === undefined) continue
    const vars = m.envVars.filter((v) => matches(v.when, stack) && !seen.has(v.name))
    for (const v of vars) seen.add(v.name)
    if (vars.length > 0) out.push({ id: m.id, title: m.title, vars })
  }
  return out
}

/** Names that have no local value: real secrets the user fills in. */
export const toFill = (groups: ReadonlyArray<EnvGroup>): string[] =>
  groups.flatMap((g) => g.vars.filter((v) => v.dev === undefined).map((v) => v.name))

/** `# Title`, then each variable's description and `NAME=value`; a real secret's says "Fill in". */
export const renderGroups = (groups: ReadonlyArray<EnvGroup>): string =>
  groups
    .map((g) =>
      [
        `# ${g.title}`,
        ...g.vars.flatMap((v) =>
          v.dev === undefined
            ? [`# Fill in: ${v.description}`, `${v.name}=`]
            : [`# ${v.description}`, `${v.name}=${v.dev}`],
        ),
      ].join("\n"),
    )
    .join("\n\n")

export const exampleHeader = (stack: StackConfig): string =>
  `# Local development settings, safe to commit. \`pnpm dev\` reads them from ${localEnvFile(stack)} (gitignored),
# which efforge writes with these values; in a fresh clone, \`cp .env.example ${localEnvFile(stack)}\`.
# An empty value marked "Fill in" is a real secret. Production values never go here: see Deploy in README.md.
`

export const LOCAL_HEADER = `# Local development settings, read by \`pnpm dev\` (gitignored). \`.env.example\` has the same names.
# Production values never go here: see Deploy in README.md.
`

/** True when `text` (a .dev.vars or .env file) assigns `name`. */
export const assigns = (text: string | undefined, name: string): boolean =>
  text !== undefined && new RegExp(`^\\s*(export\\s+)?${name}\\s*=`, "m").test(text)

/** The whole `.env.example` of a new project. */
export const envExample = (stack: StackConfig, groups: ReadonlyArray<EnvGroup>): string =>
  `${exampleHeader(stack)}\n${renderGroups(groups)}\n`

/** The local settings file of a new project. */
export const localEnv = (groups: ReadonlyArray<EnvGroup>): string =>
  `${LOCAL_HEADER}\n${renderGroups(groups)}\n`

/** `text` with `addition` appended after a blank line (or `addition` alone when `text` is empty). */
export const appendBlock = (text: string | undefined, addition: string): string => {
  if (text === undefined || text.trim() === "") return `${addition}\n`
  const base = text.endsWith("\n") ? text : `${text}\n`
  return `${base}\n${addition}\n`
}

/** True when `text` gives `name` a non-empty value. */
export const assignsValue = (text: string | undefined, name: string): boolean =>
  text !== undefined && new RegExp(`^\\s*(export\\s+)?${name}\\s*=\\s*\\S`, "m").test(text)

/** The name a `NAME=value` line assigns. */
export const nameOf = (line: string): string =>
  /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)/.exec(line)?.[1] ?? ""

/** The assignments (`NAME=value` lines) of a .dev.vars or .env file, in order. */
export const assignments = (text: string): string[] =>
  text.split(/\r?\n/).filter((l) => /^\s*(export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l))
