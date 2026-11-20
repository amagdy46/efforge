import { spawn, spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve as resolvePath } from "node:path"
import { NodeFileSystem, NodeServices } from "@effect/platform-node"
import { describe, it } from "@effect/vitest"
import { vi } from "vitest"
import { Effect, FileSystem, Layer, Path } from "effect"
import { loadAddons } from "../../src/addon.ts"
import { addAddons } from "../../src/commands/add.ts"
import { projectGraph } from "../../src/commands/graph.ts"
import { writeGraph } from "../../src/graph.ts"
import { generate } from "../../src/generate.ts"
import { ROUTE_TREE_COMMAND } from "../../src/routeTree.ts"
import { type StackConfig, withDefaults } from "../../src/stack.ts"
import { preset, stacks } from "./stacks.ts"
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

/**
 * A server function's errors and the list its caller passes are one definition, held by types:
 * the runtime card's `greet` lists `GreetErrors`, and a caller that lists anything else (one
 * missing, none, another error) does not typecheck, while the same classes written out do.
 */
const checkErrorLists = (dir: string) => {
  const probe = join(dir, "apps/web/src/error-list-probe.tsx")
  writeFileSync(
    probe,
    [
      'import { InvalidName } from "@repo/core/greeting"',
      'import { settleCall, useServerCall } from "@/lib/use-server-call"',
      'import { greet, GreetErrors } from "@/server/greeting"',
      "",
      "export function Probe() {",
      "  const spread = useServerCall(greet, ...GreetErrors)",
      "  const written = useServerCall(greet, InvalidName)",
      "  // @ts-expect-error greet lists an error, so the caller must too",
      "  const none = useServerCall(greet)",
      "  // @ts-expect-error not the list greet has",
      "  const more = useServerCall(greet, InvalidName, InvalidName)",
      "  // @ts-expect-error settleCall is held to it too",
      '  void settleCall(greet({ data: { name: "x" } }))',
      "  return [spread, written, none, more].length",
      "}",
      "",
    ].join("\n"),
  )
  try {
    sh(join(dir, "apps/web"), "pnpm exec tsc --noEmit")
  } finally {
    rmSync(probe, { force: true })
  }
}

/**
 * On D1 + Drizzle with wrangler, `pnpm db:migrate` (a create next step) writes the flat
 * `packages/db/migrations/` it derives from `packages/db/drizzle/`: git must ignore every file.
 */
const checkMigrationsIgnored = (dir: string) => {
  sh(dir, "pnpm db:migrate")
  const written = readdirSync(join(dir, "packages/db/migrations"))
  if (written.length === 0) throw new Error("pnpm db:migrate wrote no flat migrations")
  for (const file of written) sh(dir, `git check-ignore -q packages/db/migrations/${file}`)
}

/** Generates `config` into a tmp dir, installs, then runs the generated project's full gate: typecheck, check, test, build. */
const buildStack = (config: StackConfig): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const dir = yield* generateStack(config)
    yield* checkDoctor(dir)
    if (config.orm === "drizzle") yield* Effect.try(() => checkDbGenerate(dir))
    if (config.database === "d1" && config.orm === "drizzle" && config.infra === "none")
      yield* Effect.try(() => checkMigrationsIgnored(dir))
    yield* Effect.try(() => sh(dir, "pnpm typecheck && pnpm check && pnpm test && pnpm build"))
    yield* Effect.try(() => checkErrorLists(dir))
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
// commands with nothing to apply. Needs the release tags and main's history (`git fetch --tags origin`).

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
    throw new Error(`${ref} isn't in this checkout: git fetch --tags origin main`)
  mkdirSync(e2eRoot, { recursive: true })
  const dir = mkdtempSync(`${e2eRoot}/efforge-${ref.replace(/\W+/g, "-")}-`)
  sh(repo, `git archive ${found} | tar -x -C ${JSON.stringify(dir)}`)
  sh(dir, "pnpm install --frozen-lockfile")
  sources.set(ref, dir)
  return dir
}

const LAYERS = "apps/web/src/server/layers.ts"
const DASHBOARD = "apps/web/src/routes/app/index.tsx"

/**
 * The owner's own service, on a project that already has the card-era boundary (outcome.ts):
 * a `Data.TaggedError`, a server function that runs it with `runOutcome`, and a component that
 * calls it with `useServerCall`. The new boundary has to accept all three unchanged.
 */
const OWNER_SERVICE: Record<string, string> = {
  "packages/core/src/billing.ts": `import { Data, Effect } from "effect"

/** Ours: the account has no plan yet. */
export class PlanMissing extends Data.TaggedError("PlanMissing")<{ readonly message: string }> {}

/** Ours: the account's plan. */
export const currentPlan: Effect.Effect<string, PlanMissing> = Effect.fail(
  new PlanMissing({ message: "Pick a plan first." }),
)
`,
  "apps/web/src/server/plan.ts": `import { currentPlan } from "@repo/core/billing"
import { createServerFn } from "@tanstack/react-start"
import { runOutcome } from "./outcome"
import { requireSession } from "./require-session"

/** Ours: the plan, or PlanMissing as data. */
export const getPlan = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(() => runOutcome(currentPlan))
`,
  "apps/web/src/components/plan.tsx": `import { useServerCall } from "@/lib/use-server-call"
import { getPlan } from "@/server/plan"

/** Ours: shows the plan, or why there is none. */
export function Plan() {
  const { state, run } = useServerCall(getPlan)
  return (
    <button type="button" onClick={() => void run()}>
      {state.status === "failed" ? \`\${state.error._tag}: \${state.error.message}\` : "Plan"}
    </button>
  )
}
`,
}

const ownedFiles = (dir: string) =>
  existsSync(join(dir, "apps/web/src/server/outcome.ts")) &&
  existsSync(join(dir, "apps/web/src/server/require-session.ts"))
    ? Object.keys(OWNER_SERVICE)
    : []

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
  for (const file of ownedFiles(dir)) writeFileSync(join(dir, file), OWNER_SERVICE[file] ?? "")
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
          own: new Map(ownedFiles(dir).map((f) => [f, readFileSync(join(dir, f), "utf8")])),
        }
      : undefined
    const applied = yield* cliJson(["upgrade", "--json", "--cwd", dir])
    if (applied.exit !== 0 || applied.doc.ok !== true)
      throw new Error(`upgrade failed:\n${JSON.stringify(applied.doc, null, 2)}`)
    yield* Effect.try(() => sh(dir, "pnpm typecheck && pnpm check && pnpm test && pnpm build"))
    // docs/deploy.md works on the upgraded project: the root deploy script a 0.2.0 wrangler
    // project lacked is there. --dry-run builds and checks the config, and uploads nothing
    if (!flags.includes("--infra=alchemy"))
      yield* Effect.try(() => sh(dir, "pnpm run deploy --dry-run"))
    if (mine !== undefined) {
      // the owner's edits, byte for byte; layers.ts may only have gained the card region's markers
      const now = (f: string) => readFileSync(join(dir, f), "utf8")
      if (now(DASHBOARD) !== mine.dashboard)
        throw new Error("upgrade changed the owner's dashboard")
      if (now("apps/web/src/server/billing.ts") !== mine.billing)
        throw new Error("upgrade changed billing.ts")
      for (const [file, text] of mine.own)
        if (now(file) !== text) throw new Error(`upgrade changed the owner's ${file}`)
      const markers = (t: string) => t.replace(/^\/\/ #(region card|endregion)\n/gm, "")
      if (markers(now(LAYERS)) !== markers(mine.layers))
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

/**
 * The final pass's B2: `add` on a project made by an older release line writes nothing and answers
 * `UpgradeFirst`; its `fix` (upgrade), a commit and its `after` (the same add) end with the gate
 * passing, and upgrade --check --strict and doctor agreeing. rpc and cluster need Effect 4.1 and
 * files only 0.3.0 projects have.
 */
const addAfterUpgrade = (ref: string, flags: string): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const source = releaseSource(ref)
    const work = mkdtempSync(`${e2eRoot}/old-add-${ref.replace(/\W+/g, "-")}-`)
    yield* Effect.try(() =>
      sh(work, `node ${JSON.stringify(join(source, "src/bin.ts"))} old --yes ${flags}`),
    )
    const dir = join(work, "old")
    if (flags.includes("--infra=alchemy"))
      yield* Effect.try(() => sh(dir, "test -f .env || cp .env.example .env"))
    const status = () =>
      spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).stdout
    const clean = status()
    const refused = yield* cliJson(["add", "rpc", "cluster", "--json", "--cwd", dir])
    const error = refused.doc.error as Record<string, unknown> | undefined
    if (refused.exit !== 1 || error?.code !== "UpgradeFirst")
      throw new Error(`add on an old project:\n${JSON.stringify(refused.doc, null, 2)}`)
    if (status() !== clean) throw new Error(`the refused add wrote files:\n${status()}`)
    const fix = String(error.fix)
    const after = String(error.after)
    if (!fix.includes(" upgrade ") || !after.includes(" add rpc cluster "))
      throw new Error(`UpgradeFirst fix / after: ${fix} / ${after}`)
    const upgraded = yield* cliJson(["upgrade", "--json", "--cwd", dir])
    if (upgraded.exit !== 0 || upgraded.doc.ok !== true)
      throw new Error(`upgrade failed:\n${JSON.stringify(upgraded.doc, null, 2)}`)
    yield* Effect.try(() =>
      sh(
        dir,
        "git add -A && git -c user.name=e2e -c user.email=e2e@example.com commit -qm upgrade",
      ),
    )
    const added = yield* cliJson(["add", "rpc", "cluster", "--json", "--cwd", dir])
    if (added.exit !== 0 || added.doc.ok !== true)
      throw new Error(`add after upgrade:\n${JSON.stringify(added.doc, null, 2)}`)
    yield* Effect.try(() => checkEffectLockstep(dir))
    yield* Effect.try(() => sh(dir, "pnpm typecheck && pnpm check && pnpm test && pnpm build"))
    yield* Effect.try(() =>
      sh(dir, "git add -A && git -c user.name=e2e -c user.email=e2e@example.com commit -qm add"),
    )
    yield* checkDoctor(dir)
    rmSync(work, { recursive: true, force: true })
  })

/** A line as the guide quotes it and as a run prints it: versions and counts left out. */
const shapeOf = (line: string) =>
  line
    .replace(/\d+\.\d+\.\d+/g, "<version>")
    .replace(/\d+/g, "<n>")
    .trimEnd()

/**
 * The `<!-- output: <command> -->` blocks of docs/upgrading.md's worked example, each in order:
 * its lines, with `...` where the guide leaves lines out.
 */
const guideBlocks = (): Map<string, string[]> =>
  new Map(
    [
      ...readFileSync(join(repo, "docs/upgrading.md"), "utf8").matchAll(
        /<!-- output: (.+?) -->\n```text\n([\s\S]*?)```/g,
      ),
    ].map((m) => [m[1] as string, (m[2] as string).split("\n").filter((l) => l.trim() !== "")]),
  )

/** The quoted lines `block` has that `printed` lacks, in order (`...` skips any number of lines). */
const notPrinted = (block: ReadonlyArray<string>, printed: string): string[] => {
  const lines = printed.split("\n").map(shapeOf)
  const missing: string[] = []
  let at = 0
  // the first quoted line may come anywhere
  let gap = true
  for (const quoted of block) {
    if (quoted.trim() === "...") {
      gap = true
      continue
    }
    const want = shapeOf(quoted)
    // the next line, or after a `...` any later one
    const found = gap
      ? lines.indexOf(want, at)
      : lines.slice(at).findIndex((l) => l.trim() !== "") + at
    if (found === -1 || lines[found] !== want) missing.push(quoted)
    else at = found + 1
    gap = false
  }
  return missing
}

/**
 * docs/upgrading.md walks a 0.2.0 project through doctor, upgrade --check and upgrade. That project
 * is the committed fixture (test/fixtures/v0.2.0: the files add reads, and the rest of what 0.2.0
 * generated), installed, with the owner's renamed dashboard heading committed. Each quoted block is
 * held to what this efforge prints for it, counts and versions aside.
 */
const upgradingGuide = (): Effect.Effect<void, unknown> =>
  Effect.try(() => {
    const blocks = guideBlocks()
    if (
      [...blocks.keys()].join(",") !==
      "doctor,upgrade --check,upgrade,upgrade, after taking the dashboard,upgrade, after merging layers.ts"
    )
      throw new Error(`docs/upgrading.md output blocks: ${[...blocks.keys()].join(", ")}`)
    const { work, efforge } = guideProject(false)
    const problems: string[] = []
    for (const [command, exit] of [
      ["doctor", 2],
      ["upgrade --check", 2],
      ["upgrade", 0],
    ] as const) {
      const { out, code } = efforge(command)
      if (code !== exit) problems.push(`${command} exited ${code}, the guide says ${exit}`)
      for (const line of notPrinted(blocks.get(command) ?? [], out))
        problems.push(`${command} no longer prints:\n  ${line}\n--- it printed:\n${out}`)
    }
    if (problems.length > 0) throw new Error(problems.join("\n\n"))
    rmSync(work, { recursive: true, force: true })
  })

/**
 * The guide's project (the 0.2.0 fixture, installed, the owner's dashboard heading committed),
 * with `layers` also the owner's `BillingLive` in AppLayer. `efforge` runs this checkout's CLI there.
 */
const guideProject = (layers: boolean) => {
  mkdirSync(e2eRoot, { recursive: true })
  const work = mkdtempSync(`${e2eRoot}/upgrading-guide-`)
  const dir = join(work, "old-db")
  const fixtures = join(repo, "test/fixtures/v0.2.0")
  cpSync(join(fixtures, "d1-effect-sql-auth"), dir, { recursive: true })
  cpSync(join(fixtures, "d1-effect-sql-auth-rest"), dir, { recursive: true })
  for (const stored of filesUnder(dir).filter((f) => f.endsWith("/gitignore"))) {
    cpSync(stored, stored.replace(/gitignore$/, ".gitignore"))
    rmSync(stored)
  }
  const dashboard = join(dir, DASHBOARD)
  writeFileSync(
    dashboard,
    readFileSync(dashboard, "utf8").replace(">Dashboard</h1>", ">Acme dashboard</h1>"),
  )
  if (layers) {
    writeFileSync(
      join(dir, "apps/web/src/server/billing.ts"),
      'import { Layer } from "effect"\n\n/** Billing, ours. */\nexport const BillingLive = Layer.empty\n',
    )
    const file = join(dir, LAYERS)
    writeFileSync(
      file,
      readFileSync(file, "utf8")
        .replace(
          'import { AuthLive } from "./auth-live"',
          'import { AuthLive } from "./auth-live"\nimport { BillingLive } from "./billing"',
        )
        .replace("  AuthLive,\n", "  AuthLive,\n  BillingLive,\n"),
    )
  }
  sh(dir, "pnpm install")
  sh(dir, "git init -q")
  commitAll(dir, "owner")
  const efforge = (args: string) => {
    const r = spawnSync(`node ${JSON.stringify(join(repo, "src/bin.ts"))} ${args}`, {
      cwd: dir,
      shell: true,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", CI: "1" },
    })
    return { out: `${r.stdout}${r.stderr}`, code: r.status }
  }
  return { work, dir, efforge }
}

const commitAll = (dir: string, message: string) =>
  sh(dir, `git add -A && git -c user.name=e2e -c user.email=e2e@localhost commit -qm '${message}'`)

/**
 * docs/upgrading.md's "When you changed layers.ts too": the guide's project with the owner's layer
 * in AppLayer, through upgrade, efforge's dashboard taken, upgrade, the card region merged into
 * layers.ts by hand, upgrade; each quoted block is what that run prints, and the gate passes.
 */
const upgradingGuideLayers = (): Effect.Effect<void, unknown> =>
  Effect.try(() => {
    const blocks = guideBlocks()
    const { work, dir, efforge } = guideProject(true)
    const problems: string[] = []
    const step = (command: string, exit: number, block?: string) => {
      const { out, code } = efforge(command)
      if (code !== exit) problems.push(`${command} exited ${code}, the guide says ${exit}\n${out}`)
      if (block !== undefined)
        for (const line of notPrinted(blocks.get(block) ?? [], out))
          problems.push(`${block} no longer prints:\n  ${line}\n--- it printed:\n${out}`)
      return out
    }
    step("upgrade", 0)
    commitAll(dir, "upgrade")
    writeFileSync(
      join(dir, "dashboard.diff"),
      step(`upgrade --check --diff --file ${DASHBOARD}`, 0),
    )
    sh(dir, "git apply dashboard.diff && rm dashboard.diff")
    commitAll(dir, "dashboard: take efforge version")
    step("upgrade", 2, "upgrade, after taking the dashboard")
    commitAll(dir, "upgrade again")
    const file = join(dir, LAYERS)
    writeFileSync(
      file,
      readFileSync(file, "utf8")
        .replace(
          "/**\n * The app",
          "// #region card\n/** Telemetry, underneath every layer. */\nexport const TelemetryLive = Layer.mergeAll(Layer.empty /* efforge:telemetry */)\n\n/**\n * The app",
        )
        .replace(
          "  /* efforge:layers */\n)\n",
          "  /* efforge:layers */\n).pipe(Layer.provideMerge(TelemetryLive))\n// #endregion\n",
        ),
    )
    sh(dir, "pnpm format")
    commitAll(dir, "layers: the card region")
    step("upgrade", 0, "upgrade, after merging layers.ts")
    if (problems.length > 0) throw new Error(problems.join("\n\n"))
    commitAll(dir, "upgrade a third time")
    sh(dir, "pnpm typecheck && pnpm check && pnpm test && pnpm build")
    if (efforge("upgrade --check --strict").code !== 0)
      throw new Error("upgrade --check --strict after the guide's last step")
    rmSync(work, { recursive: true, force: true })
  })

describe("upgrade an old project", () => {
  const releases: Array<[string, string, string]> = [
    ["0.2.0", "v0.2.0", "--database=d1 --orm=effect-sql"],
    // 0.2.1 as merged into main (#3); the merge commit has the same tree
    [
      "0.2.1",
      "3f4fa0ffdb3f0bdd25c7bdef8131031afbc08f64",
      "--database=d1 --orm=effect-sql --auth=better-auth --infra=alchemy --extras=storage,email",
    ],
    // a project made by next before the errors-over-the-wire change: it has the cards, outcome.ts
    // and the session gate, and its owner wrote a service of their own on them
    [
      "next (896be2a)",
      "896be2a83df3b1e9bcf1156b4204c2f661eeb40c",
      "--database=d1 --orm=drizzle --auth=better-auth --extras=storage,email,realtime",
    ],
    // a project made by next with the cluster card, before one error list per server function:
    // each card names its errors twice, and nothing in core knows <Name>Errors
    [
      "next (055d320)",
      "055d320586b09d21fd3364cefec6cf32dcaa5fc7",
      "--database=d1 --orm=effect-sql --auth=better-auth --extras=workflows,realtime,cluster",
    ],
  ]
  it.effect(
    "docs/upgrading.md's 0.2.0 example: each quoted line is what doctor, upgrade --check and upgrade print",
    () => upgradingGuide(),
    { timeout: 20 * 60 * 1000 },
  )
  it.effect(
    "docs/upgrading.md's edited layers.ts example: each quoted line is what each upgrade prints, then the gate",
    () => upgradingGuideLayers(),
    { timeout: 20 * 60 * 1000 },
  )
  for (const [version, ref, flags] of releases.slice(0, 2))
    it.effect(
      `${version}: add answers UpgradeFirst and writes nothing; upgrade, then the same add, then the full gate`,
      () => addAfterUpgrade(ref, flags),
      { timeout: 20 * 60 * 1000 },
    )
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
          extras: ["workflows", "realtime", "browser", "storage", "email", "rpc", "cluster"],
        }),
      ),
    { timeout: 15 * 60 * 1000 },
  )
})
