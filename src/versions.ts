import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"

const effect4 = "4.0.5"

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
  alchemy: "2.0.0-beta.83",
  "better-auth": "1.7.10",
  "@tanstack/react-start": "1.169.3",
  "effect-cf": "0.56.7",
  "drizzle-orm": "1.0.0-rc.4",
  "drizzle-kit": "1.0.0-rc.4",
  "@clack/prompts": "1.8.1",
  magicast: "0.5.5",
  "ts-morph": "28.0.0",
}

/** Walks up from this file (src/ or dist/) to efforge's own package.json. */
const readVersion = (): string => {
  let dir = import.meta.dirname
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: string
        version?: string
      }
      if (pkg.name === "efforge" && pkg.version !== undefined) return pkg.version
    } catch {}
    const parent = dirname(dir)
    if (parent === dir) return "0.0.0"
    dir = parent
  }
}

export const efforgeVersion: string = readVersion()
