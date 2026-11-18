import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { dirname, join, resolve as resolvePath } from "node:path"
import { NodeFileSystem, NodeServices } from "@effect/platform-node"
import { describe, it } from "@effect/vitest"
import { Effect, FileSystem, Path } from "effect"
import { loadAddons } from "../../src/addon.ts"
import { addAddons } from "../../src/commands/add.ts"
import { generate } from "../../src/generate.ts"
import { ROUTE_TREE_COMMAND } from "../../src/routeTree.ts"
import { type StackConfig, withDefaults } from "../../src/stack.ts"
import type { Tree } from "../../src/tree.ts"
import { isEffectLockstep } from "../../src/versions.ts"
import { parse, parseAllDocuments } from "yaml"

const templates = new URL("../../templates", import.meta.url).pathname
// Under the repo (gitignored), not os.tmpdir(): /tmp is often a small tmpfs.
const e2eRoot = new URL("../../.e2e", import.meta.url).pathname

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

/**
 * Unmet peers inside third-party packages that efforge can't fix from a template. Upstream as of
 * 2026-11-18: @alchemy.run/cloudflare-runtime depends on `unenv: ^2.0.0-rc.24` (now rc.25) and on
 * @cloudflare/unenv-preset, which peers on exactly 2.0.0-rc.24. The stack still passes its gate.
 */
const knownUpstreamPeer = (peer: string, parents: ReadonlyArray<{ name: string }>) =>
  peer === "unenv" &&
  parents.some((p) => p.name === "@alchemy.run/cloudflare-runtime") &&
  parents.at(-1)?.name === "@cloudflare/unenv-preset"

/**
 * What the drift guard promises, checked against the real install: every package released with
 * `effect` resolved to the catalog's `effect` version (not only the ones the project names), and
 * pnpm reports no unmet peers.
 */
const checkEffectLockstep = (dir: string) => {
  const read = (file: string) => parse(readFileSync(`${dir}/${file}`, "utf8"))
  const effect = (read("pnpm-workspace.yaml") as { catalog: Record<string, string> }).catalog.effect
  // pnpm 12 writes the lockfile as several YAML documents; packages live in one of them
  const keys = parseAllDocuments(readFileSync(`${dir}/pnpm-lock.yaml`, "utf8")).flatMap((doc) =>
    Object.keys((doc.toJS() as { packages?: Record<string, unknown> } | null)?.packages ?? {}),
  )
  if (!keys.some((key) => key.startsWith("effect@")))
    throw new Error("pnpm-lock.yaml lists no effect package; the check would prove nothing")
  const drifted = keys.filter((key) => {
    const at = key.lastIndexOf("@")
    return isEffectLockstep(key.slice(0, at)) && key.slice(at + 1) !== effect
  })
  if (drifted.length > 0)
    throw new Error(`Effect packages not at effect ${effect}: ${drifted.join(", ")}`)
  // optional peers outside their range are warnings (alchemy's capnp-es asks for typescript 5 or
  // 6); a required peer, or any Effect package, out of range is a failure
  const peers = spawnSync("pnpm", ["peers", "check", "--json"], { cwd: dir, encoding: "utf8" })
  type Issue = {
    optional: boolean
    wantedRange?: string
    foundVersion?: string
    parents: Array<{ name: string }>
  }
  const report = JSON.parse(peers.stdout) as Record<
    string,
    { bad: Record<string, Issue[]>; missing: Record<string, Issue[]> }
  >
  const unmet = Object.entries(report).flatMap(([project, r]) =>
    [...Object.entries(r.bad), ...Object.entries(r.missing)].flatMap(([peer, issues]) =>
      issues
        .filter((i) => !i.optional || isEffectLockstep(peer))
        .filter((i) => !knownUpstreamPeer(peer, i.parents))
        .map((i) => `${project}: ${peer} ${i.foundVersion ?? "missing"}, wanted ${i.wantedRange}`),
    ),
  )
  if (unmet.length > 0) throw new Error(`unmet peers:\n${unmet.join("\n")}`)
}

/** Generates `config` into a tmp dir and installs it, ready for the checks `create` runs next. */
const generateStack = (config: StackConfig): Effect.Effect<string, unknown> =>
  Effect.gen(function* () {
    const tree = yield* generate(config, yield* loadAddons(templates))
    mkdirSync(e2eRoot, { recursive: true })
    const dir = mkdtempSync(`${e2eRoot}/${config.name}-`)
    yield* writeTree(dir, tree)
    yield* Effect.try(() => {
      sh(dir, "pnpm install --no-frozen-lockfile")
      checkEffectLockstep(dir)
      // what `create` runs after installing: git init (own repo root, so a parent's ignore rules
      // don't apply), generate the route tree, then format
      sh(dir, "git init -q")
      sh(dir, ROUTE_TREE_COMMAND)
      sh(dir, "pnpm format")
    })
    return dir
  }).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Path.layer))

const filesUnder = (root: string): string[] =>
  readdirSync(root, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))

/**
 * Only the marked region of a file a card shows may reach the browser (apps/web/regions.ts). Every
 * comment line outside a region of such a file must be missing from the built client assets: a
 * comment survives there only inside a whole file shipped as a string. Returns how many it checked.
 */
const checkRegionsOnly = (dir: string): number => {
  const web = join(dir, "apps/web")
  const client = filesUnder(join(web, "dist/client"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n")
  const shown = new Set<string>()
  for (const file of filesUnder(join(web, "src")).filter((f) => /\.tsx?$/.test(f)))
    for (const m of readFileSync(file, "utf8").matchAll(/from "([^"]+)\?region=card"/g))
      shown.add(resolvePath(dirname(file), m[1] as string))
  let checked = 0
  for (const file of shown) {
    let inside = false
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (/\/\/ #region card/.test(line)) inside = true
      else if (/\/\/ #endregion/.test(line)) inside = false
      else if (!inside) {
        const comment = /^\s*(?:\/\/|\/?\*+)\s*(.{20,})$/
          .exec(line)?.[1]
          ?.replace(/\*\/$/, "")
          .trim()
        if (comment === undefined || /["'`\\]/.test(comment)) continue
        if (client.includes(comment))
          throw new Error(
            `${file}: "${comment}" is outside its card region but in the client bundle`,
          )
        checked++
      }
    }
  }
  return checked
}

/** Generates `config` into a tmp dir, installs, then runs the generated project's full gate: typecheck, check, test, build. */
const buildStack = (config: StackConfig): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const dir = yield* generateStack(config)
    yield* Effect.try(() => sh(dir, "pnpm typecheck && pnpm check && pnpm test && pnpm build"))
    // a minimal stack's card files may have nothing outside their regions; auth and database ones do
    const checked = yield* Effect.try(() => checkRegionsOnly(dir))
    if (checked === 0 && (config.auth !== "none" || config.database !== "none"))
      return yield* Effect.fail(
        new Error(`checkRegionsOnly checked no lines on ${JSON.stringify(config)}`),
      )
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
    "pg-drizzle-orgs-alchemy",
    {
      name: "pg-drizzle-orgs-alchemy",
      database: "postgres",
      orm: "drizzle",
      auth: "better-auth-orgs",
      infra: "alchemy",
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
  [
    "pg-drizzle-alchemy",
    {
      name: "pg-drizzle-alchemy",
      database: "postgres",
      orm: "drizzle",
      auth: "none",
      infra: "alchemy",
    },
  ],
  [
    "house",
    {
      name: "house",
      database: "postgres",
      orm: "drizzle",
      auth: "better-auth-orgs",
      infra: "alchemy",
      ai: "effect-ai-byok",
      extras: ["workflows", "realtime", "browser", "storage", "email"],
    },
  ],
  [
    "d1-ai-email",
    {
      name: "d1-ai-email",
      database: "d1",
      orm: "effect-sql",
      auth: "better-auth-orgs",
      infra: "none",
      ai: "effect-ai-byok",
      extras: ["email"],
    },
  ],
  [
    "d1-better-auth-alchemy-ai",
    {
      name: "d1-better-auth-alchemy-ai",
      database: "d1",
      orm: "effect-sql",
      auth: "better-auth",
      infra: "alchemy",
      ai: "effect-ai-byok",
    },
  ],
  [
    "pg-effect-sql-alchemy-email",
    {
      name: "pg-effect-sql-alchemy-email",
      database: "postgres",
      orm: "effect-sql",
      auth: "none",
      infra: "alchemy",
      extras: ["email"],
    },
  ],
  [
    "pg-drizzle-extras-alchemy",
    {
      name: "pg-drizzle-extras-alchemy",
      database: "postgres",
      orm: "drizzle",
      auth: "none",
      infra: "alchemy",
      extras: ["storage", "workflows", "realtime", "browser"],
    },
  ],
]

describe("stacks build", () => {
  for (const [name, partial] of stacks)
    it.effect(name, () => buildStack(withDefaults(partial)), { timeout: 15 * 60 * 1000 })
})

describe("add on a real project", () => {
  it.effect(
    "pg-drizzle-orgs + add email + add ai/effect-ai-byok passes the full gate",
    () =>
      Effect.gen(function* () {
        const dir = yield* generateStack(
          withDefaults({
            name: "pg-orgs-added",
            database: "postgres",
            orm: "drizzle",
            auth: "better-auth-orgs",
            infra: "none",
          }),
        )
        // installs and generates the route tree itself; the result must pass without a format step
        yield* addAddons(dir, ["email", "ai/effect-ai-byok"], {
          overwrite: false,
          dryRun: false,
          install: true,
        })
        yield* Effect.try(() => checkEffectLockstep(dir))
        yield* Effect.try(() => sh(dir, "pnpm typecheck && pnpm check && pnpm test && pnpm build"))
        rmSync(dir, { recursive: true, force: true })
      }).pipe(Effect.provide(NodeServices.layer)),
    { timeout: 15 * 60 * 1000 },
  )
})

describe.skipIf(process.env.EFFORGE_E2E_BROWSER !== "1")("browser flow", () => {
  it.effect(
    "pg-drizzle-orgs + realtime: sign up, create org, see the cards, invite, accept, both members visible",
    () =>
      browserFlow(
        withDefaults({
          name: "pg-drizzle-orgs-browser",
          database: "postgres",
          orm: "drizzle",
          auth: "better-auth-orgs",
          infra: "none",
          extras: ["realtime"],
        }),
      ),
    { timeout: 15 * 60 * 1000 },
  )
})
