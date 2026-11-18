// `pnpm smoke:pack`: proves the published package works on a machine that has nothing but npm.
// Packs the tarball, checks its manifest declares no dependencies, installs it with npm into an
// empty directory (no lockfile), and runs the CLI from there: --version, --help, a --dry-run
// create, a real create and an `add` that goes through the ts-morph transforms. Also runs the
// tarball through `npx` and `pnpm dlx`, the way the README tells people to start.
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const work = mkdtempSync(join(tmpdir(), "efforge-smoke-"))
const keep = process.argv.includes("--keep")

const run = (cmd: string, args: ReadonlyArray<string>, cwd: string): string => {
  console.log(`$ ${[cmd, ...args].join(" ")}   (in ${cwd})`)
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // the generated project must not inherit this repo's pnpm/npm settings
      env: { ...process.env, npm_config_yes: "true", CI: "1" },
    })
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string }
    console.error(err.stdout ?? "", err.stderr ?? "")
    throw new Error(`failed: ${[cmd, ...args].join(" ")}`, { cause: e })
  }
}

const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`smoke:pack: ${what}`)
  console.log(`  ok: ${what}`)
}

try {
  // 1. build, then pack (the build's log would otherwise land in pack's JSON output)
  run("pnpm", ["build"], root)
  const packed = JSON.parse(
    run("pnpm", ["pack", "--ignore-scripts", "--pack-destination", work, "--json"], root),
  ) as { filename: string }
  const tarball = packed.filename.startsWith("/") ? packed.filename : join(work, packed.filename)

  // 2. the packed manifest resolves nothing at install time
  const manifest = JSON.parse(
    run("tar", ["-xOf", tarball, "package/package.json"], work),
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

  // 3. npm install into an empty directory, no lockfile
  const app = join(work, "consumer")
  mkdirSync(app)
  writeFileSync(join(app, "package.json"), '{ "name": "consumer", "private": true }\n')
  run("npm", ["install", "--no-package-lock", "--no-audit", "--no-fund", tarball], app)
  const bin = join(app, "node_modules", ".bin", "create-efforge")
  const version = run(bin, ["--version"], app).trim()
  check(version.includes(String(manifest.version)), `--version prints ${String(manifest.version)}`)
  check(run(bin, ["--help"], app).includes("create-efforge"), "--help prints usage")
  check(
    run(bin, ["dry", "--yes", "--dry-run"], app).includes("dry run: nothing written"),
    "a --dry-run create works",
  )

  // 4. a real create (no install: this checks the CLI, not the stack) and an add that runs the
  // AST transforms (ts-morph) from the bundle
  run(bin, ["my-app", "--yes", "--no-install", "--no-git"], app)
  const project = join(app, "my-app")
  const layersFile = join(project, "apps/web/src/server/layers.ts")
  check(!readFileSync(layersFile, "utf8").includes("MailerLive"), "fresh project has no mailer")
  run(bin, ["add", "email", "--no-install"], project)
  check(readFileSync(layersFile, "utf8").includes("MailerLive"), "add email wired MailerLive")
  check(
    readFileSync(join(project, "packages/core/src/index.ts"), "utf8").includes("./mailer"),
    "add email exported the mailer",
  )

  // 5. the README's entry points, straight from the tarball
  const npx = join(work, "npx")
  mkdirSync(npx)
  check(
    run(
      "npx",
      ["--yes", "--package", tarball, "create-efforge", "x", "--yes", "--dry-run"],
      npx,
    ).includes("dry run"),
    "npx --package <tarball> create-efforge --dry-run works",
  )
  check(
    run("pnpm", ["dlx", tarball, "x", "--yes", "--dry-run"], npx).includes("dry run"),
    "pnpm dlx <tarball> --dry-run works",
  )
  console.log("\nsmoke:pack passed")
} finally {
  if (keep) console.log(`kept ${work}`)
  else rmSync(work, { recursive: true, force: true })
}
