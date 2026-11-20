import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"

/** `effect` and every package released with it (see `effectLockstep`). */
export const effectVersion = "4.1.4"
const effect4 = effectVersion

/** Exact pins for every package templates may depend on. The only place versions live. */
export const versions: Record<string, string> = {
  effect: effect4,
  "@effect/platform-node": effect4,
  "@effect/sql-pg": effect4,
  "@effect/sql-d1": effect4,
  "@effect/vitest": effect4,
  "@effect/ai-anthropic": effect4,
  "@effect/ai-openai": effect4,
  "@effect/ai-openrouter": effect4,
  // experimental upstream (extras/cluster): an API may change in a patch release, so it moves only with effect
  "@effect/platform-cloudflare": effect4,
  "@effect/sql-sqlite-node": effect4,
  alchemy: "2.0.0-beta.87",
  // the Cloudflare provider, split out of `alchemy` in 2.0.0-beta.87; keep it on the alchemy version
  "@alchemy.run/cloudflare": "2.0.0-beta.87",
  "better-auth": "1.7.25",
  "@tanstack/react-start": "1.169.5",
  "effect-cf": "0.59.0",
  "drizzle-orm": "1.0.0-rc.5",
  "drizzle-kit": "1.0.0-rc.5",
  "@clack/prompts": "1.9.0",
  magicast: "0.5.5",
  "ts-morph": "28.0.0",
  "vite-plus": "1.7.0",
  oxlint: "1.94.0",
  "oxlint-tsgolint": "7.0.2007",
  "@effect/tsgo": "0.70.0",
  "@cloudflare/containers": "0.3.7",
  "@cloudflare/vite-plugin": "1.70.0",
  "@cloudflare/workers-types": "5.20261118.1",
  "@tailwindcss/vite": "4.3.5",
  "@tanstack/react-router": "1.170.46",
  // router-cli is versioned with @tanstack/router-generator; keep it on the generator @tanstack/react-start depends on
  "@tanstack/router-cli": "1.168.0",
  "@types/node": "26.6.6",
  "@types/pg": "8.23.1",
  "@types/react": "19.3.0",
  "@types/react-dom": "19.3.0",
  "@vitejs/plugin-react": "6.3.0",
  "class-variance-authority": "0.7.1",
  clsx: "2.1.1",
  "lucide-react": "1.75.0",
  "radix-ui": "1.8.1",
  pg: "8.23.1",
  playwright: "1.65.1",
  react: "19.3.1",
  "react-dom": "19.3.1",
  sonner: "2.0.8",
  "tailwind-merge": "3.7.0",
  tailwindcss: "4.3.5",
  "tw-animate-css": "1.4.0",
  turbo: "2.11.13",
  typescript: "7.0.2",
  vite: "8.3.8",
  // the vitest vite-plus bundles (one copy in the install); bump.ts fails if they differ
  vitest: "5.1.0",
  wrangler: "4.164.0",
}

/**
 * Packages released in lockstep with `effect` (Effect-TS/effect-smol `packages/`): any two must be
 * the same version. `@effect/tsgo` and `@effect/language-service` are versioned on their own.
 * Patterns use pnpm's override wildcard (`*`).
 */
export const effectLockstep: ReadonlyArray<string> = [
  "effect",
  "@effect/ai-*",
  "@effect/atom-*",
  "@effect/openapi-generator",
  "@effect/opentelemetry",
  "@effect/platform-*",
  "@effect/sql-*",
  "@effect/vitest",
]

const matchesPattern = (name: string, pattern: string): boolean =>
  pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern

/** True for a package that must carry the same version as `effect`. */
export const isEffectLockstep = (name: string): boolean =>
  effectLockstep.some((p) => matchesPattern(name, p))

/**
 * The override key for each lockstep pattern. `effect` is scoped to Effect 4, so a library that
 * depends on Effect 3 (uploadthing, @prisma/config) keeps its own copy instead of getting Effect 4.
 */
export const overrideKey = (pattern: string): string =>
  pattern === "effect" ? "effect@>=4.0.0-0" : pattern

/**
 * The generated `pnpm-workspace.yaml` overrides that hold every lockstep package at `version`,
 * including ones nothing in the project names directly and that only arrive as another
 * package's dependency or auto-installed peer (drizzle-orm and effect-cf peer on `@effect/sql-*`).
 */
export const effectOverrides = (version: string): Record<string, string> =>
  Object.fromEntries(effectLockstep.map((p) => [overrideKey(p), version]))

/** The pnpm generated projects pin in `packageManager` (templates/base/files/root/package.json). */
export const pnpmVersion = "12.21.0"

/** pnpm accepts wildcard override keys before this version and ignores them (ADR 0005). */
export const pnpmWildcardOverrides = "12.17.0"

/**
 * efforge's own package root: the nearest directory above this module whose package.json is
 * create-efforge. Works from `src/` (tests, `node src/bin.ts`) and from the single bundled
 * `dist/bin.js`, whatever their depth.
 */
const findPackageRoot = (): { readonly dir: string; readonly version: string } | undefined => {
  let dir = import.meta.dirname
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: string
        version?: string
      }
      if (pkg.name === "create-efforge" && pkg.version !== undefined)
        return { dir, version: pkg.version }
    } catch {}
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

const packageRoot = findPackageRoot()

export const efforgeVersion: string = packageRoot?.version ?? "0.0.0"

/** The shipped `templates/` dir, next to `src/` and `dist/`. */
export const templatesDir: string = join(packageRoot?.dir ?? import.meta.dirname, "templates")

/**
 * Pins that move together: bumping one without the others breaks a build or the lint toolchain.
 * `upgrade --check` names the set when any member differs, so nobody bumps half of one. `match`
 * lists exact names or `effectLockstep`-style patterns.
 */
export const pinSets: ReadonlyArray<{
  readonly id: string
  readonly match: ReadonlyArray<string>
  readonly why: string
}> = [
  {
    id: "effect",
    match: effectLockstep,
    why: "Effect's packages are released together and only work at one shared version; the overrides in pnpm-workspace.yaml must match the catalog's effect (ADR 0005)",
  },
  {
    id: "drizzle",
    match: ["drizzle-orm", "drizzle-kit"],
    why: "drizzle-kit writes the migrations drizzle-orm reads; they are released as a pair",
  },
  {
    id: "alchemy",
    match: ["alchemy", "@alchemy.run/cloudflare"],
    why: "the Cloudflare provider was split out of alchemy and is released on the same version",
  },
  {
    id: "lint-toolchain",
    match: ["@effect/tsgo", "typescript", "oxlint", "oxlint-tsgolint", "vite-plus", "vitest"],
    why: "@effect/tsgo patches only the TypeScript and Oxlint versions it lists, and vite-plus bundles its own oxlint and vitest (ADR 0001)",
  },
  {
    id: "tanstack",
    match: ["@tanstack/react-start", "@tanstack/react-router", "@tanstack/router-cli"],
    why: "the router CLI is versioned with the router generator @tanstack/react-start depends on",
  },
  {
    id: "react",
    match: ["react", "react-dom", "@types/react", "@types/react-dom"],
    why: "react and react-dom must be the same version, and their types follow them",
  },
  {
    id: "tailwind",
    match: ["tailwindcss", "@tailwindcss/vite"],
    why: "the Vite plugin is released with tailwindcss",
  },
]

/** The set `name` belongs to, or undefined. */
export const pinSetOf = (name: string): (typeof pinSets)[number] | undefined =>
  pinSets.find((s) => s.match.some((p) => matchesPattern(name, p)))
