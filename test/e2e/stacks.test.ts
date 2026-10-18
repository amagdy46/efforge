import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { NodeFileSystem } from "@effect/platform-node"
import { describe, it } from "@effect/vitest"
import { Effect, FileSystem, Path } from "effect"
import { loadAddons } from "../../src/addon.ts"
import { generate } from "../../src/generate.ts"
import { type StackConfig, withDefaults } from "../../src/stack.ts"
import type { Tree } from "../../src/tree.ts"

const templates = new URL("../../templates", import.meta.url).pathname

const writeTree = (dir: string, tree: Tree) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    for (const [file, content] of tree) {
      const target = path.join(dir, file)
      yield* fs.makeDirectory(path.dirname(target), { recursive: true })
      yield* fs.writeFileString(target, content)
    }
  })

const sh = (cwd: string, command: string) => {
  const r = spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
  })
  if (r.status !== 0) throw new Error(`\`${command}\` exited ${r.status}\n${r.stdout}\n${r.stderr}`)
}

/** Generates `config` into a tmp dir and installs it, ready for the checks `create` runs next. */
const generateStack = (config: StackConfig): Effect.Effect<string, unknown> =>
  Effect.gen(function* () {
    const tree = yield* generate(config, yield* loadAddons(templates))
    const dir = mkdtempSync(`${tmpdir()}/efforge-${config.name}-`)
    yield* writeTree(dir, tree)
    yield* Effect.try(() => {
      sh(dir, "pnpm install --no-frozen-lockfile")
      // what `create` runs after installing, before the project's first lint
      spawnSync("pnpm exec biome check --write .", { cwd: dir, shell: true })
    })
    return dir
  }).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Path.layer))

/** Generates `config` into a tmp dir, installs, then typechecks, lints and builds it. */
const buildStack = (config: StackConfig): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const dir = yield* generateStack(config)
    yield* Effect.try(() => sh(dir, "pnpm typecheck && pnpm lint && pnpm build"))
    rmSync(dir, { recursive: true, force: true })
  })

const waitForServer = async (url: string) => {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${url} did not come up`)
}

/**
 * Runs the generated project's `pnpm dev` against a real Postgres and drives it with Playwright.
 * Needs a reachable database (default: the docker-compose one; override with
 * EFFORGE_E2E_DATABASE_URL) and a Chromium for the pinned Playwright.
 */
const browserFlow = (config: StackConfig): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const dir = yield* generateStack(config)
    const databaseUrl =
      process.env.EFFORGE_E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/app"
    const port = process.env.EFFORGE_E2E_PORT ?? "5199"
    const baseURL = `http://localhost:${port}`
    const dev = yield* Effect.try(() => {
      sh(dir, `DATABASE_URL=${databaseUrl} pnpm db:migrate`)
      sh(dir, `sed -i 's|http://localhost:5173|${baseURL}|' .dev.vars`)
      return spawn(
        "pnpm",
        ["--filter", "web", "exec", "vite", "dev", "--port", port, "--strictPort"],
        {
          cwd: dir,
          detached: true,
          stdio: "ignore",
          env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
            CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: databaseUrl,
          },
        },
      )
    })
    yield* Effect.tryPromise(async () => {
      try {
        await waitForServer(`${baseURL}/sign-in`)
        await (await import("./browser-flow.ts")).orgsFlow(baseURL)
      } finally {
        // the dev server is a process group (pnpm -> vite -> workerd); stop all of it
        if (dev.pid !== undefined) process.kill(-dev.pid)
      }
    })
    rmSync(dir, { recursive: true, force: true })
  })

const stacks: Array<[string, Parameters<typeof withDefaults>[0]]> = [
  [
    "minimal",
    {
      name: "minimal",
      database: "none",
      orm: "none",
      auth: "none",
      infra: "none",
      ai: "none",
      extras: [],
    },
  ],
  [
    "pg-drizzle",
    { name: "pg-drizzle", database: "postgres", orm: "drizzle", auth: "none", infra: "none" },
  ],
  [
    "d1-effect-sql",
    { name: "d1-effect-sql", database: "d1", orm: "effect-sql", auth: "none", infra: "none" },
  ],
  [
    "pg-drizzle-orgs",
    {
      name: "pg-drizzle-orgs",
      database: "postgres",
      orm: "drizzle",
      auth: "better-auth-orgs",
      infra: "none",
    },
  ],
  [
    "pg-effect-sql-orgs",
    {
      name: "pg-effect-sql-orgs",
      database: "postgres",
      orm: "effect-sql",
      auth: "better-auth-orgs",
      infra: "none",
    },
  ],
  [
    "d1-drizzle-auth",
    { name: "d1-drizzle-auth", database: "d1", orm: "drizzle", auth: "better-auth", infra: "none" },
  ],
  [
    "extras-no-db",
    {
      name: "extras-no-db",
      database: "none",
      orm: "none",
      auth: "none",
      infra: "none",
      ai: "none",
      extras: ["storage", "workflows", "realtime", "browser"],
    },
  ],
  [
    "pg-drizzle-extras",
    {
      name: "pg-drizzle-extras",
      database: "postgres",
      orm: "drizzle",
      auth: "none",
      infra: "none",
      extras: ["storage", "workflows", "realtime"],
    },
  ],
]

describe("stacks build", () => {
  for (const [name, partial] of stacks)
    it.effect(name, () => buildStack(withDefaults(partial)), { timeout: 15 * 60 * 1000 })
})

describe.skipIf(process.env.EFFORGE_E2E_BROWSER !== "1")("browser flow", () => {
  it.effect(
    "pg-drizzle-orgs: sign up, create org, invite, accept, both members visible",
    () =>
      browserFlow(
        withDefaults({
          name: "pg-drizzle-orgs-browser",
          database: "postgres",
          orm: "drizzle",
          auth: "better-auth-orgs",
          infra: "none",
        }),
      ),
    { timeout: 15 * 60 * 1000 },
  )
})
