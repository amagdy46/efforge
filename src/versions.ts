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
  "drizzle-orm": "1.0.0-rc.5-5935859",
  "drizzle-kit": "1.0.0-rc.5-5935859",
  "@clack/prompts": "1.8.1",
  magicast: "0.5.5",
  "ts-morph": "28.0.0",
  "@biomejs/biome": "2.5.15",
  "@cloudflare/vite-plugin": "1.64.0",
  "@cloudflare/workers-types": "5.20261015.1",
  "@tailwindcss/vite": "4.3.3",
  "@tanstack/react-router": "1.170.45",
  "@types/node": "26.6.5",
  "@types/react": "19.3.0",
  "@types/react-dom": "19.3.0",
  "@vitejs/plugin-react": "6.1.2",
  "class-variance-authority": "0.7.1",
  clsx: "2.1.1",
  "lucide-react": "1.59.0",
  "radix-ui": "1.8.1",
  react: "19.3.1",
  "react-dom": "19.3.1",
  sonner: "2.0.8",
  "tailwind-merge": "3.7.0",
  tailwindcss: "4.3.3",
  "tw-animate-css": "1.4.0",
  turbo: "2.11.9",
  typescript: "7.0.2",
  vite: "8.3.4",
  vitest: "5.0.5",
  wrangler: "4.151.1",
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
