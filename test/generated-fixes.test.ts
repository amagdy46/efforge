import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { afterEach, beforeEach, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { loadAddons } from "../src/addon.ts"
import { addAddons } from "../src/commands/add.ts"
import { defaultTemplatesDir } from "../src/commands/create.ts"
import { generate } from "../src/generate.ts"
import { planSteps } from "../src/readme.ts"
import { type StackConfig, withDefaults } from "../src/stack.ts"
import { writeTree } from "../src/write.ts"

// The bugs found by following the generated README literally (W2-D), each pinned by what the
// generated project does, so reverting a fix fails here.

const generated = (config: StackConfig) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* generate(config, yield* loadAddons(defaultTemplatesDir))
    }).pipe(Effect.provide(NodeServices.layer)),
  )

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "efforge-fixes-"))
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

it("pnpm run deploy deploys the built config: wrangler refuses the redirect from apps/web", async () => {
  for (const config of [
    withDefaults({ name: "app" }),
    withDefaults({ name: "app", database: "none", orm: "none", auth: "none" }),
  ]) {
    const tree = await generated(config)
    const web = JSON.parse(tree.get("apps/web/package.json") as string).scripts
    expect(web.deploy).toBe("pnpm build && wrangler deploy --config dist/server/wrangler.json")
    const root = JSON.parse(tree.get("package.json") as string)
    expect(root.scripts.deploy).toBe("pnpm --filter web run deploy")
    // so `pnpm exec wrangler ...` in the README runs from the root
    expect(root.devDependencies.wrangler).toBeDefined()
  }
})

/** Runs the generated `packages/db/scripts/migrate.ts` with a `wrangler` that records its arguments. */
const migrateArgs = async (config: StackConfig, args: string[], withConfig = true) => {
  const dir = join(tmp, `${config.orm}-${args.join("")}-${String(withConfig)}`)
  await Effect.runPromise(
    writeTree(dir, await generated(config)).pipe(Effect.provide(NodeServices.layer)),
  )
  if (!withConfig) rmSync(join(dir, "wrangler.jsonc"), { force: true })
  const bin = join(dir, ".fake-bin")
  mkdirSync(bin)
  const log = join(dir, "wrangler-args.txt")
  writeFileSync(join(bin, "wrangler"), `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\n`)
  chmodSync(join(bin, "wrangler"), 0o755)
  const r = spawnSync(process.execPath, ["packages/db/scripts/migrate.ts", ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
  })
  let recorded: string[] | undefined
  try {
    recorded = readFileSync(log, "utf8").trim().split("\n")
  } catch {}
  return { status: r.status, stderr: r.stderr, recorded, dir }
}

for (const orm of ["drizzle", "effect-sql"] as const)
  it(`D1 + ${orm}: pnpm db:migrate --remote doesn't pass --local too, which wrangler refuses`, async () => {
    const config = withDefaults({ name: "app", database: "d1", orm })
    const local = await migrateArgs(config, [])
    expect(local.status, local.stderr).toBe(0)
    expect(local.recorded).toContain("--local")
    expect(local.recorded).not.toContain("--remote")
    const remote = await migrateArgs(config, ["--remote"])
    expect(remote.status, remote.stderr).toBe(0)
    expect(remote.recorded).toContain("--remote")
    expect(remote.recorded).not.toContain("--local")
    // without wrangler.jsonc (Alchemy) it says what to do, runs nothing and writes nothing
    const none = await migrateArgs(config, [], false)
    expect(none.status).toBe(1)
    expect(none.stderr).toContain("with Alchemy, `pnpm dev` migrates the local D1")
    expect(none.recorded).toBeUndefined()
  })

it("D1 + drizzle without wrangler.jsonc: no migrations/ directory is left behind", async () => {
  const none = await migrateArgs(
    withDefaults({ name: "app", database: "d1", orm: "drizzle" }),
    [],
    false,
  )
  expect(none.status).toBe(1)
  expect(() => readFileSync(join(none.dir, "packages/db/migrations/0001_init.sql"))).toThrow()
})

it("Alchemy + Postgres: alchemy dev turns TLS off only for a database on this machine", async () => {
  const run = (await generated(withDefaults({ name: "app", infra: "alchemy" }))).get(
    "infra/alchemy.run.ts",
  ) as string
  // the local Hyperdrive needs a `dev` origin, or it asks the docker-compose Postgres for TLS
  expect(run).toMatch(/dev: \{ \.\.\.origin, sslmode: local \? "disable" : "require" \}/)
  expect(run).toContain(
    'const local = ["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname)',
  )
  // no default keyed on the stage name: the local value comes from .env
  expect(run).not.toContain('stage.startsWith("dev")')
})

it("Alchemy: create writes the local settings to .env, which alchemy dev reads, and says to copy nothing", async () => {
  const config = withDefaults({ name: "app", infra: "alchemy", extras: ["storage", "email"] })
  const tree = await generated(config)
  expect(tree.has(".dev.vars")).toBe(false)
  const env = tree.get(".env") as string
  for (const line of [
    "BETTER_AUTH_SECRET=dev-only-",
    "BETTER_AUTH_URL=\n",
    "DATABASE_URL=postgres://postgres:postgres@localhost:5432/app",
    "STORAGE_SIGNING_SECRET=dev-only-",
    "MAIL_TRANSPORT=console",
  ])
    expect(env).toContain(line)
  // the committed example has the same values, so a clone can copy it
  const example = tree.get(".env.example") as string
  for (const l of env.split("\n").filter((x) => /^[A-Z_]+=/.test(x))) expect(example).toContain(l)
  const steps = planSteps(config, { installed: true }).map((s) => s.command)
  expect(steps.some((c) => c.startsWith("cp "))).toBe(false)
  expect(planSteps(config, { installed: true }).at(-1)).toMatchObject({
    command: "pnpm dev",
    note: "http://localhost:1337",
  })
})

// W2-D review S2: Alchemy reads .env, so every add writes the local values there, and adding
// Alchemy moves what .dev.vars held, so nobody copies between two files
const addOpts = { overwrite: false, dryRun: false, install: false }
const settings = (dir: string, file: string) => {
  try {
    return readFileSync(join(dir, file), "utf8")
  } catch {
    return undefined
  }
}

it("add infra/alchemy moves .dev.vars to .env, the user's lines with it", async () => {
  const dir = join(tmp, "move")
  await Effect.runPromise(
    writeTree(dir, await generated(withDefaults({ name: "app" }))).pipe(
      Effect.provide(NodeServices.layer),
    ),
  )
  const before = `${settings(dir, ".dev.vars")}MY_OWN=kept\n`
  writeFileSync(join(dir, ".dev.vars"), before)
  const result = await Effect.runPromise(
    addAddons(dir, ["infra/alchemy"], addOpts).pipe(Effect.provide(NodeServices.layer)),
  )
  expect(settings(dir, ".dev.vars")).toBeUndefined()
  expect(result.removed).toContain(".dev.vars")
  const env = settings(dir, ".env") as string
  for (const l of before.split("\n").filter((x) => /^[A-Z_]+=/.test(x))) expect(env).toContain(l)
  expect(env).toContain("CLOUDFLARE_ACCOUNT_ID=")
  expect(result.envVars.every((v) => v.file === ".env")).toBe(true)
}, 30_000)

it("add infra/alchemy keeps an existing .env and adds only the names it lacks", async () => {
  const dir = join(tmp, "merge")
  await Effect.runPromise(
    writeTree(dir, await generated(withDefaults({ name: "app" }))).pipe(
      Effect.provide(NodeServices.layer),
    ),
  )
  writeFileSync(join(dir, ".env"), "BETTER_AUTH_SECRET=mine\nOTHER=2\n")
  await Effect.runPromise(
    addAddons(dir, ["infra/alchemy"], addOpts).pipe(Effect.provide(NodeServices.layer)),
  )
  const env = settings(dir, ".env") as string
  expect(env.startsWith("BETTER_AUTH_SECRET=mine\nOTHER=2\n")).toBe(true)
  expect(env.match(/^BETTER_AUTH_SECRET=/gm)).toHaveLength(1)
  expect(env).toContain("DATABASE_URL=postgres://postgres:postgres@localhost:5432/app")
  expect(settings(dir, ".dev.vars")).toBeUndefined()
}, 30_000)

for (const variant of ["as created", "fresh clone"] as const)
  it(`Alchemy, ${variant}: add storage writes its local value to .env, not .dev.vars`, async () => {
    const dir = join(tmp, variant.replace(" ", "-"))
    await Effect.runPromise(
      writeTree(dir, await generated(withDefaults({ name: "app", infra: "alchemy" }))).pipe(
        Effect.provide(NodeServices.layer),
      ),
    )
    if (variant === "fresh clone") rmSync(join(dir, ".env"))
    const result = await Effect.runPromise(
      addAddons(dir, ["storage"], addOpts).pipe(Effect.provide(NodeServices.layer)),
    )
    expect(settings(dir, ".dev.vars")).toBeUndefined()
    const env = settings(dir, ".env") as string
    expect(env).toMatch(/^STORAGE_SIGNING_SECRET=\S+/m)
    // a clone gets every setting, so pnpm dev starts
    expect(env).toContain("BETTER_AUTH_SECRET=dev-only-")
    expect(result.envVars).toEqual([
      expect.objectContaining({ name: "STORAGE_SIGNING_SECRET", file: ".env", set: true }),
    ])
  }, 30_000)
