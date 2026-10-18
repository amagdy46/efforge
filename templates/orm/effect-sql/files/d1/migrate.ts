import { spawnSync } from "node:child_process"

// `pnpm db:migrate`: wrangler applies packages/db/migrations/NNNN_name.sql to the local D1 database
// (migrations_dir in wrangler.jsonc). Extra arguments go to wrangler (e.g. `--remote`).
const root = new URL("..", import.meta.url).pathname
const result = spawnSync(
  "wrangler",
  [
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--config",
    `${root}../../wrangler.jsonc`,
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
)
process.exit(result.status ?? 1)
