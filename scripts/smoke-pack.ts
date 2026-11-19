import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"

/**
 * `pnpm smoke:pack`: proves the published package works on a machine that has nothing but npm
 * and pnpm. The repo's lockfile and node_modules play no part: everything runs outside the repo,
 * with its own npm cache.
 *
 *   pnpm smoke:pack [--tarball create-efforge-x.y.z.tgz] [--dir <work dir>] [--keep]
 *
 * Without --tarball it builds dist/ and packs. Then:
 *   1. the packed package.json declares no dependencies, so nothing is resolved at install time;
 *   2. `npm install` of the tarball into an empty directory (no lockfile), then --version, --help,
 *      a --dry-run create, a create with no install and an `add email` (the ts-morph transforms);
 *   3. the README's entry points with the tarball: `npx --package` and `pnpm dlx`, as dry runs;
 *   4. what `npm create efforge` does: `npm exec` the tarball, create the default stack with
 *      install and git, `pnpm build` it, `efforge add email` with the packed bin, build again.
 */

const { values } = parseArgs({
  options: {
    tarball: { type: "string" },
    dir: { type: "string" },
    keep: { type: "boolean", default: false },
  },
})

const repo = join(import.meta.dirname, "..")
const base = resolve(values.dir ?? tmpdir())
mkdirSync(base, { recursive: true })
const work = mkdtempSync(join(base, "efforge-smoke-"))
// its own npm cache, so nothing installed earlier answers for this run, and none of the npm_*
// variables `pnpm smoke:pack` sets (npm_config_user_agent says pnpm), as on a clean machine
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k))),
  npm_config_cache: join(work, "npm-cache"),
  npm_config_yes: "true",
  CI: "1",
}

class StepFailed extends Error {}

/** Runs a command and returns its stdout; prints both streams if it fails. */
const run = (title: string, cmd: string, args: ReadonlyArray<string>, cwd: string): string => {
  console.log(`\n=== ${title}\n$ ${[cmd, ...args].join(" ")}  (in ${cwd})`)
  try {
    return execFileSync(cmd, args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string }
    console.error(err.stdout ?? "", err.stderr ?? "")
    throw new StepFailed(title)
  }
}

/** Runs a long command with its output streamed. */
const step = (title: string, cmd: string, args: ReadonlyArray<string>, cwd: string) => {
  console.log(`\n=== ${title}\n$ ${[cmd, ...args].join(" ")}  (in ${cwd})`)
  try {
    execFileSync(cmd, args, { cwd, env, stdio: "inherit" })
  } catch {
    throw new StepFailed(title)
  }
}

const check = (ok: boolean, what: string) => {
  if (!ok) throw new StepFailed(what)
  console.log(`  ok: ${what}`)
}

let ok = false
try {
  // 1. the tarball: given, or built and packed (the build's log would otherwise land in pack's output)
  let tarball = values.tarball === undefined ? undefined : resolve(values.tarball)
  if (tarball === undefined) {
    const packs = join(work, "pack")
    mkdirSync(packs)
    step("build", "pnpm", ["build"], repo)
    step("pack", "pnpm", ["pack", "--ignore-scripts", "--pack-destination", packs], repo)
    const file = readdirSync(packs).find((f) => f.endsWith(".tgz"))
    if (file === undefined) throw new Error(`pnpm pack wrote no .tgz into ${packs}`)
    tarball = join(packs, file)
  }
  console.log(`tarball: ${tarball}`)

  const manifest = JSON.parse(
    run("read the packed manifest", "tar", ["-xOf", tarball, "package/package.json"], work),
  ) as Record<string, unknown>
  for (const field of [
    "dependencies",
    "peerDependencies",
    "optionalDependencies",
    "bundledDependencies",
    "bundleDependencies",
  ])
    check(
      manifest[field] === undefined || Object.keys(manifest[field] as object).length === 0,
      `packed package.json has no ${field}`,
    )
  const version = String(manifest.version)

  // 2. npm install into an empty directory, no lockfile
  const consumer = join(work, "consumer")
  mkdirSync(consumer)
  writeFileSync(join(consumer, "package.json"), '{ "name": "consumer", "private": true }\n')
  step(
    "npm install the tarball",
    "npm",
    ["install", "--no-package-lock", "--no-audit", "--no-fund", tarball],
    consumer,
  )
  const bin = join(consumer, "node_modules", ".bin", "create-efforge")
  check(
    run("--version", bin, ["--version"], consumer).includes(version),
    `--version prints ${version}`,
  )
  check(run("--help", bin, ["--help"], consumer).includes("create-efforge"), "--help prints usage")
  check(
    run("dry run", bin, ["dry", "--yes", "--dry-run"], consumer).includes(
      "Dry run: nothing written",
    ),
    "a --dry-run create works",
  )
  run("create, no install", bin, ["my-app", "--yes", "--no-install", "--no-git"], consumer)
  const project = join(consumer, "my-app")
  const layersFile = join(project, "apps/web/src/server/layers.ts")
  check(!readFileSync(layersFile, "utf8").includes("MailerLive"), "fresh project has no mailer")
  run("add email, no install", bin, ["add", "email", "--no-install"], project)
  check(readFileSync(layersFile, "utf8").includes("MailerLive"), "add email wired MailerLive")
  check(
    readFileSync(join(project, "packages/core/src/index.ts"), "utf8").includes("./mailer"),
    "add email exported the mailer",
  )
  check(
    run("graph", bin, ["graph", "--format=text"], project).includes("MailerLive"),
    "graph shows the layer add email wired",
  )
  check(
    run("info", bin, ["info", "email", "--json"], project).includes('"installed": true'),
    "info sees the add-on in the project",
  )

  // 3. the README's entry points, straight from the tarball
  const entry = join(work, "entry")
  mkdirSync(entry)
  check(
    run(
      "npx --package",
      "npx",
      ["--yes", "--package", tarball, "create-efforge", "x", "--yes", "--dry-run"],
      entry,
    ).includes("Dry run"),
    "npx --package <tarball> create-efforge --dry-run works",
  )
  check(
    run("pnpm dlx", "pnpm", ["dlx", tarball, "x", "--yes", "--dry-run"], entry).includes("Dry run"),
    "pnpm dlx <tarball> --dry-run works",
  )

  // 4. what `npm create efforge` does, through a real install and build
  const cli = (name: string, ...args: string[]) => [
    "exec",
    "--yes",
    `--package=${tarball}`,
    "--",
    name,
    ...args,
  ]
  step("create the default stack", "npm", cli("create-efforge", "smoke-app", "--yes"), work)
  const app = join(work, "smoke-app")
  step("build the new project", "pnpm", ["build"], app)
  step("add an add-on with the packed CLI", "npm", cli("efforge", "add", "email"), app)
  check(
    readFileSync(join(app, "apps/web/src/server/layers.ts"), "utf8").includes("MailerLive"),
    "add email wired MailerLive in the installed project",
  )
  step("build after add", "pnpm", ["build"], app)

  ok = true
  console.log(`\nsmoke:pack passed (create-efforge ${version})`)
} catch (e) {
  if (!(e instanceof StepFailed)) throw e
  console.error(`\nsmoke:pack failed at "${e.message}". Work dir: ${work}`)
  process.exitCode = 1
} finally {
  if (ok && !values.keep) rmSync(work, { recursive: true, force: true })
  else if (ok) console.log(`kept ${work}`)
}
