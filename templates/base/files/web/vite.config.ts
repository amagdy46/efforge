import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { regions } from "./regions"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [regions(), tanstackStart(), tailwindcss(), viteReact()],
})
