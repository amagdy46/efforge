import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { clientGuard, regions } from "./regions.ts"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [regions(), clientGuard(), tanstackStart(), tailwindcss(), viteReact()],
})
