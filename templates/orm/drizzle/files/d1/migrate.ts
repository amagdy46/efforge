import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs"

// `pnpm db:migrate`: wrangler applies a flat directory of NNNN_name.sql files, but drizzle-kit
// writes one folder per migration. Flatten drizzle/<id>/migration.sql into migrations/, then
// apply to the local D1 database. Extra arguments go to wrangler (e.g. `--remote`).
const root = new URL("..", import.meta.url).pathname
const source = `${root}drizzle`
const target = `${root}migrations`

mkdirSync(target, { recursive: true })
readdirSync(source)
  .filter((dir) => existsSync(`${source}/${dir}/migration.sql`))
  .toSorted()
  .forEach((dir, index) => {
    const name = dir.replace(/^\d+_/, "")
    copyFileSync(
      `${source}/${dir}/migration.sql`,
      `${target}/${String(index + 1).padStart(4, "0")}_${name}.sql`,
    )
  })

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
