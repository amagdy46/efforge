import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    cloudflare({
      configPath: "../../wrangler.jsonc",
      viteEnvironment: { name: "ssr" },
      // the repo-root default of `wrangler d1 ... --local`, so migrations and dev share one state
      persistState: { path: "../../.wrangler/state" },
    }),
    tanstackStart(),
    tailwindcss(),
    viteReact(),
  ],
})
