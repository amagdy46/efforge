import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"

// `pnpm db:migrate`: wrangler applies packages/db/migrations/NNNN_name.sql to the local D1 database
// (migrations_dir in wrangler.jsonc). Extra arguments go to wrangler (e.g. `--remote`).
const root = new URL("..", import.meta.url).pathname
const config = `${root}../../wrangler.jsonc`
if (!existsSync(config)) {
  console.error(
    "No wrangler.jsonc: with Alchemy, `pnpm dev` migrates the local D1 and `pnpm run deploy` the deployed one.",
  )
  process.exit(1)
}
// wrangler refuses --local together with --remote
const args = process.argv.slice(2)
const result = spawnSync(
  "wrangler",
  [
    "d1",
    "migrations",
    "apply",
    "DB",
    ...(args.includes("--remote") ? [] : ["--local"]),
    "--config",
    config,
    ...args,
  ],
  { stdio: "inherit" },
)
process.exit(result.status ?? 1)
