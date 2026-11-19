import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve as resolvePath } from "node:path"
import { NodeFileSystem, NodeServices } from "@effect/platform-node"
import { describe, it } from "@effect/vitest"
import { vi } from "vitest"
import { Effect, FileSystem, Layer, Path } from "effect"
import { loadAddons } from "../../src/addon.ts"
import { addAddons } from "../../src/commands/add.ts"
import { projectGraph } from "../../src/commands/graph.ts"
import { writeGraph } from "../../src/graph.ts"
import { type Preset, presetById } from "../../src/presets.ts"
import { generate } from "../../src/generate.ts"
import { ROUTE_TREE_COMMAND } from "../../src/routeTree.ts"
import { type StackConfig, withDefaults } from "../../src/stack.ts"
import type { Tree } from "../../src/tree.ts"
import { classifyPeers } from "../../src/doctor.ts"
import { runWith } from "../../src/cli.ts"
import { PromptIOLive } from "../../src/prompts/navigable.ts"
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
  // optional peers outside their range, and the known upstream Alchemy one, are not failures; a
  // required peer, or any Effect package, out of range is (the same rule as `doctor`'s peers check)
  const peers = spawnSync("pnpm", ["peers", "check", "--json"], { cwd: dir, encoding: "utf8" })
  const { unmet } = classifyPeers(JSON.parse(peers.stdout))
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

/**
 * `upgrade --check --json` and `doctor --json` on a project efforge just made and installed: nothing
 * to do, and no check fails. Run in-process with the real spawner; doctor's Postgres check is pointed
 * at a closed port, so the run touches no database.
 */
const checkDoctor = (dir: string) =>
  Effect.gen(function* () {
    const json = (args: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const out: string[] = []
        const log = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
          out.push(a.join(" "))
        })
        const before = process.env.DATABASE_URL
        process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:9/app"
        process.exitCode = undefined
        // its own runtime: it.effect's test console would swallow the document
        yield* Effect.promise(() =>
          Effect.runPromise(
            runWith(args).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, PromptIOLive))),
          ),
        ).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              log.mockRestore()
              if (before === undefined) delete process.env.DATABASE_URL
              else process.env.DATABASE_URL = before
            }),
          ),
        )
        const exit = process.exitCode ?? 0
        process.exitCode = undefined
        return { doc: JSON.parse(out.join("\n")) as Record<string, unknown>, exit }
      })
    const upgrade = yield* json(["upgrade", "--check", "--strict", "--json", "--cwd", dir])
    const left = [...(upgrade.doc.steps as unknown[]), ...(upgrade.doc.kept as unknown[])]
    if (upgrade.exit !== 0 || upgrade.doc.status !== "current" || left.length > 0)
      throw new Error(
        `upgrade --check found something on a new project:\n${JSON.stringify({ steps: upgrade.doc.steps, kept: upgrade.doc.kept, needsAction: upgrade.doc.needsAction }, null, 2)}`,
      )
    const doctor = yield* json(["doctor", "--json", "--cwd", dir])
    const failed = (
      doctor.doc.checks as Array<{ id: string; status: string; message: string }>
    ).filter((c) => c.status === "fail")
    if (doctor.exit !== 0 || failed.length > 0)
      throw new Error(
        `doctor failed on a new project:\n${failed.map((c) => `${c.id}: ${c.message}`).join("\n")}`,
      )
  })

/**
 * The README and AGENTS.md tell people to run `pnpm db:generate` after a schema change: on a fresh
 * project it must exit 0 and write nothing, or the committed Drizzle snapshots are stale.
 */
const checkDbGenerate = (dir: string) => {
  const db = join(dir, "packages/db")
  const files = () =>
    filesUnder(db)
      .filter((f) => !f.includes("node_modules"))
      .map((f) => `${f}\n${readFileSync(f, "utf8")}`)
      .join("\n")
  const before = files()
  const r = spawnSync("pnpm db:generate", { cwd: dir, shell: true, encoding: "utf8" })
  const out = `${r.stdout}\n${r.stderr}`
  if (r.status !== 0) throw new Error(`pnpm db:generate exited ${r.status}\n${out}`)
  if (!/No schema changes/.test(out))
    throw new Error(`pnpm db:generate wanted a migration:\n${out}`)
  if (files() !== before) throw new Error("pnpm db:generate changed files in packages/db")
}

/** Generates `config` into a tmp dir, installs, then runs the generated project's full gate: typecheck, check, test, build. */
const buildStack = (config: StackConfig): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const dir = yield* generateStack(config)
    yield* checkDoctor(dir)
    if (config.orm === "drizzle") yield* Effect.try(() => checkDbGenerate(dir))
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
    // the session guard's bypasses go in before the app runs: they must be refused
    yield* Effect.tryPromise(async () => (await import("./browser-flow.ts")).plantBypasses(dir))
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

const preset = (id: string) => (presetById(id) as Preset).stack

const stacks: Array<[string, Parameters<typeof withDefaults>[0]]> = [
  // the minimal preset's stack
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
  ["preset-saas", { name: "preset-saas", ...preset("saas") }],
  ["preset-ai", { name: "preset-ai", ...preset("ai") }],
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
        yield* Effect.try(() => checkDbGenerate(dir))
        yield* Effect.try(() => sh(dir, "pnpm typecheck && pnpm check && pnpm test && pnpm build"))
        rmSync(dir, { recursive: true, force: true })
      }).pipe(Effect.provide(NodeServices.layer)),
    { timeout: 15 * 60 * 1000 },
  )
})

describe("graph on a real project", () => {
  it.effect(
    "the saas preset + graph --write + add realtime: the README keeps its graph and the gate passes",
    () =>
      Effect.gen(function* () {
        const dir = yield* generateStack(withDefaults({ name: "graph-saas", ...preset("saas") }))
        const { graph } = yield* projectGraph(dir)
        const readme = readFileSync(join(dir, "README.md"), "utf8")
        const filled = writeGraph(readme, graph)
        if (filled.kind !== "filled") throw new Error(`graph --write: ${filled.kind}`)
        writeFileSync(join(dir, "README.md"), filled.text)
        yield* addAddons(dir, ["realtime"], { overwrite: false, dryRun: false, install: true })
        const after = readFileSync(join(dir, "README.md"), "utf8")
        if (!after.includes("RealtimeLive")) throw new Error("add didn't redraw the README's graph")
        yield* Effect.try(() => sh(dir, "pnpm typecheck && pnpm check && pnpm test && pnpm build"))
        rmSync(dir, { recursive: true, force: true })
      }).pipe(Effect.provide(NodeServices.layer)),
    { timeout: 15 * 60 * 1000 },
  )
})

// --- upgrade an old project (ruling 1 of the W4-A2 review) -------------------------------------
// A real project from an efforge release, with and without the owner's own edits in layers.ts and
// the dashboard, then `upgrade` from this source, then the project's full gate. Whatever upgrade
// applies must leave the project building, keep the owner's edits byte for byte, and leave both
// commands with nothing to apply. Needs the release refs (`git fetch --tags origin release-0.2.1`).

const repo = new URL("../..", import.meta.url).pathname
const sources = new Map<string, string>()

/** The efforge source at `ref`, installed, under .e2e (once per run). */
const releaseSource = (ref: string): string => {
  const hit = sources.get(ref)
  if (hit !== undefined) return hit
  const found = [ref, `origin/${ref}`].find(
    (r) =>
      spawnSync("git", ["rev-parse", "--verify", "-q", `${r}^{commit}`], { cwd: repo }).status ===
      0,
  )
  if (found === undefined)
    throw new Error(`${ref} isn't in this checkout: git fetch --tags origin release-0.2.1`)
  mkdirSync(e2eRoot, { recursive: true })
  const dir = mkdtempSync(`${e2eRoot}/efforge-${ref.replace(/\W+/g, "-")}-`)
  sh(repo, `git archive ${found} | tar -x -C ${JSON.stringify(dir)}`)
  sh(dir, "pnpm install --frozen-lockfile")
  sources.set(ref, dir)
  return dir
}

const LAYERS = "apps/web/src/server/layers.ts"
const DASHBOARD = "apps/web/src/routes/app/index.tsx"

/** The owner's own work: a layer of theirs in AppLayer, and a heading of theirs on the dashboard. */
const ownerEdits = (dir: string) => {
  const write = (file: string, f: (t: string) => string) =>
    writeFileSync(join(dir, file), f(readFileSync(join(dir, file), "utf8")))
  writeFileSync(
    join(dir, "apps/web/src/server/billing.ts"),
    'import { Layer } from "effect"\n\n/** Billing, ours. */\nexport const BillingLive = Layer.empty\n',
  )
  write(LAYERS, (t) =>
    t
      .replace(
        'import { AuthLive } from "./auth-live"',
        'import { AuthLive } from "./auth-live"\nimport { BillingLive } from "./billing"',
      )
      .replace("  AuthLive,\n", "  AuthLive,\n  BillingLive,\n"),
  )
  write(DASHBOARD, (t) => t.replace(">Dashboard<", ">Acme dashboard<"))
  sh(dir, "pnpm format")
  sh(
    dir,
    "git add -A && git -c user.name=e2e -c user.email=e2e@example.com commit -qm 'our billing layer and dashboard'",
  )
}

const cliJson = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const out: string[] = []
    const log = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      out.push(a.join(" "))
    })
    process.exitCode = undefined
    yield* Effect.promise(() =>
      Effect.runPromise(
        runWith(args).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, PromptIOLive))),
      ),
    ).pipe(Effect.ensuring(Effect.sync(() => log.mockRestore())))
    const exit = process.exitCode ?? 0
    process.exitCode = undefined
    return { doc: JSON.parse(out.join("\n")) as Record<string, unknown>, exit }
  })

const upgradeOld = (ref: string, flags: string, edited: boolean): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const source = releaseSource(ref)
    const work = mkdtempSync(`${e2eRoot}/old-${ref.replace(/\W+/g, "-")}-`)
    yield* Effect.try(() =>
      sh(work, `node ${JSON.stringify(join(source, "src/bin.ts"))} old --yes ${flags}`),
    )
    const dir = join(work, "old")
    // 0.2.1's own next step on Alchemy: the local values come from the example
    if (flags.includes("--infra=alchemy"))
      yield* Effect.try(() => sh(dir, "test -f .env || cp .env.example .env"))
    if (edited) yield* Effect.try(() => ownerEdits(dir))
    const mine = edited
      ? {
          layers: readFileSync(join(dir, LAYERS), "utf8"),
          dashboard: readFileSync(join(dir, DASHBOARD), "utf8"),
          billing: readFileSync(join(dir, "apps/web/src/server/billing.ts"), "utf8"),
        }
      : undefined
    const applied = yield* cliJson(["upgrade", "--json", "--cwd", dir])
    if (applied.exit !== 0 || applied.doc.ok !== true)
      throw new Error(`upgrade failed:\n${JSON.stringify(applied.doc, null, 2)}`)
    yield* Effect.try(() => sh(dir, "pnpm typecheck && pnpm check && pnpm test && pnpm build"))
    if (mine !== undefined) {
      // the owner's edits, byte for byte; layers.ts may only have gained the card region's markers
      const now = (f: string) => readFileSync(join(dir, f), "utf8")
      if (now(DASHBOARD) !== mine.dashboard)
        throw new Error("upgrade changed the owner's dashboard")
      if (now("apps/web/src/server/billing.ts") !== mine.billing)
        throw new Error("upgrade changed billing.ts")
      if (now(LAYERS).replace(/^\/\/ #(region card|endregion)\n/gm, "") !== mine.layers)
        throw new Error(
          `upgrade changed the owner's layers.ts beyond the region markers:\n${now(LAYERS)}`,
        )
    }
    // both commands agree that nothing is left to apply
    const again = yield* cliJson(["upgrade", "--check", "--strict", "--json", "--cwd", dir])
    if (again.exit !== 0 || again.doc.status !== "current")
      throw new Error(`upgrade --check after upgrade:\n${JSON.stringify(again.doc, null, 2)}`)
    const before = process.env.DATABASE_URL
    process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:9/app"
    const doctor = yield* cliJson(["doctor", "--json", "--cwd", dir]).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (before === undefined) delete process.env.DATABASE_URL
          else process.env.DATABASE_URL = before
        }),
      ),
    )
    const failed = (
      doctor.doc.checks as Array<{ id: string; status: string; message: string }>
    ).filter((c) => c.status === "fail" || (c.id === "upgrade" && c.status !== "ok"))
    if (failed.length > 0)
      throw new Error(
        `doctor after upgrade:\n${failed.map((c) => `${c.id}: ${c.message}`).join("\n")}`,
      )
    rmSync(work, { recursive: true, force: true })
  })

describe("upgrade an old project", () => {
  const releases: Array<[string, string, string]> = [
    ["0.2.0", "v0.2.0", "--database=d1 --orm=effect-sql"],
    [
      "0.2.1",
      "release-0.2.1",
      "--database=d1 --orm=effect-sql --auth=better-auth --infra=alchemy --extras=storage,email",
    ],
  ]
  for (const [version, ref, flags] of releases)
    for (const edited of [false, true])
      it.effect(
        `${version}${edited ? " with the owner's edits in layers.ts and the dashboard" : ""}: upgrade, then the full gate`,
        () => upgradeOld(ref, flags, edited),
        { timeout: 20 * 60 * 1000 },
      )
})

describe.skipIf(process.env.EFFORGE_E2E_BROWSER !== "1")("browser flow", () => {
  it.effect(
    "pg-drizzle-orgs + every add-on: sign up, create org, use every card, invite, accept, both members visible",
    () =>
      browserFlow(
        withDefaults({
          name: "pg-drizzle-orgs-browser",
          database: "postgres",
          orm: "drizzle",
          auth: "better-auth-orgs",
          infra: "none",
          ai: "effect-ai-byok",
          extras: ["workflows", "realtime", "browser", "storage", "email"],
        }),
      ),
    { timeout: 15 * 60 * 1000 },
  )
})
