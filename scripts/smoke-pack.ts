import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"

/**
 * Installs the packed CLI the way `npm create efforge` does and runs what a new user runs:
 * create the default stack, build it, add an add-on, build again. The repo's lockfile and
 * node_modules play no part: npm resolves the tarball's dependencies fresh, into its own cache.
 *
 *   node scripts/smoke-pack.ts [--tarball create-efforge-x.y.z.tgz] [--dir <work dir>] [--keep]
 *
 * Without --tarball it runs `pnpm pack` first (which builds dist/).
 */

const { values } = parseArgs({
  options: {
    tarball: { type: "string" },
    dir: { type: "string" },
    keep: { type: "boolean", default: false },
  },
})

const repo = new URL("..", import.meta.url).pathname
const base = resolve(values.dir ?? tmpdir())
mkdirSync(base, { recursive: true })
const work = mkdtempSync(join(base, "efforge-smoke-"))

class StepFailed extends Error {}

const step = (title: string, cmd: string, args: string[], cwd: string) => {
  console.log(`\n=== ${title}\n$ ${[cmd, ...args].join(" ")}  (in ${cwd})`)
  try {
    execFileSync(cmd, args, {
      cwd,
      stdio: "inherit",
      // its own npm cache, so nothing installed earlier answers for this run
      env: { ...process.env, npm_config_cache: join(work, "npm-cache"), CI: "1" },
    })
  } catch {
    throw new StepFailed(title)
  }
}

let ok = false
try {
  let tarball = values.tarball === undefined ? undefined : resolve(values.tarball)
  if (tarball === undefined) {
    const packs = join(work, "pack")
    mkdirSync(packs)
    step("pack", "pnpm", ["pack", "--pack-destination", packs], repo)
    const file = readdirSync(packs).find((f) => f.endsWith(".tgz"))
    if (file === undefined) throw new Error(`pnpm pack wrote no .tgz into ${packs}`)
    tarball = join(packs, file)
  }
  const cli = (bin: string, ...args: string[]) => [
    "exec",
    "--yes",
    `--package=${tarball}`,
    "--",
    bin,
    ...args,
  ]

  step("version", "npm", cli("create-efforge", "--version"), work)
  step("create the default stack", "npm", cli("create-efforge", "smoke-app", "--yes"), work)
  const app = join(work, "smoke-app")
  step("build the new project", "pnpm", ["build"], app)
  step("add an add-on with the packed CLI", "npm", cli("efforge", "add", "email"), app)
  step("build after add", "pnpm", ["build"], app)
  ok = true
  console.log("\nsmoke-pack: the packed CLI created, built, added and built again.")
} catch (e) {
  if (!(e instanceof StepFailed)) throw e
  console.error(`\nsmoke-pack failed at "${e.message}". Work dir: ${work}`)
  process.exitCode = 1
} finally {
  if (ok && !values.keep) rmSync(work, { recursive: true, force: true })
}
