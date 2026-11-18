import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeFileSystem, NodeServices } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect, type FileSystem, Path } from "effect"
import { loadAddons } from "../src/addon.ts"
import { CARDS_DIR, REGISTRY_FILE } from "../src/cards.ts"
import { addAddons } from "../src/commands/add.ts"
import { generate } from "../src/generate.ts"
import { validate } from "../src/rules.ts"
import { type StackConfig, withDefaults } from "../src/stack.ts"
import type { Tree } from "../src/tree.ts"
import { writeTree } from "../src/write.ts"

// Add-ons contribute a card to apps/web/src/capabilities/registry.ts (docs/capability-cards.md).
// Every dashboard page has to render that list, or the cards silently disappear.

const templates = new URL("../templates", import.meta.url).pathname
const DASHBOARD = "apps/web/src/routes/app/index.tsx"

const run = <A, E>(eff: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.runPromise(eff.pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Path.layer)))

const rendersRegistry = (source: string) =>
  /import \{ capabilities \} from "@\/capabilities\/registry"/.test(source) &&
  /capabilities\.map\(/.test(source)

/** The names in `capabilities = [...]`, in order. */
const registered = (tree: ReadonlyMap<string, string>): string[] => {
  const list = /capabilities: ReadonlyArray<Capability> = \[([^\]]*)\]/.exec(
    tree.get(REGISTRY_FILE) ?? "",
  )?.[1]
  return (list ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Each registered name is imported from a card module that exists and exports it. */
const expectModules = (tree: Tree, where: string) => {
  const registry = tree.get(REGISTRY_FILE) ?? ""
  for (const name of registered(tree)) {
    const from = new RegExp(`import \\{ ${name} \\} from "\\./([\\w-]+)"`).exec(registry)?.[1]
    expect(from, `${where}: import of ${name}`).toBeDefined()
    const module = tree.get(`${CARDS_DIR}${from}.tsx`) ?? ""
    expect(module, `${where}: ${from}.tsx`).toContain(`export const ${name}: Capability`)
  }
}

it("every add-on file that replaces the dashboard renders the card registry", async () => {
  const addons = await run(loadAddons(templates))
  const dashboards = [...addons.values()].flatMap(({ manifest, dir }) =>
    [...manifest.files, ...(manifest.card?.files ?? [])]
      .filter((f) => f.target === DASHBOARD)
      .map((f) => ({ id: manifest.id, path: join(dir, f.path) })),
  )
  expect(dashboards.map((d) => d.id)).toContain("base")
  for (const d of dashboards)
    expect(rendersRegistry(readFileSync(d.path, "utf8")), `${d.id}: ${d.path}`).toBe(true)
})

const combos: StackConfig[] = (["none", "postgres", "d1"] as const).flatMap((database) =>
  (["none", "drizzle", "effect-sql"] as const).flatMap((orm) =>
    (["none", "better-auth", "better-auth-orgs"] as const).map((auth) =>
      withDefaults({
        name: "app",
        database,
        orm,
        auth,
        ai: "effect-ai-byok",
        extras: ["realtime", "workflows", "browser"],
      }),
    ),
  ),
)

it("every database, ORM and auth registers its cards, and the dashboard renders them", async () => {
  const addons = await run(loadAddons(templates))
  let checked = 0
  for (const config of combos) {
    const valid = await Effect.runPromise(Effect.result(validate(config)))
    if (valid._tag === "Failure") continue
    const tree = await run(generate(config, addons))
    const where = `${config.database}/${config.orm}/${config.auth}`
    expect(registered(tree), where).toEqual([
      "runtime",
      ...(config.orm === "none" ? [] : ["database"]),
      ...(config.auth === "none" ? [] : ["auth"]),
      "ai",
      "workflows",
      "realtime",
      "browser",
    ])
    expectModules(tree, where)
    expect(rendersRegistry(tree.get(DASHBOARD) ?? ""), where).toBe(true)
    checked++
  }
  expect(checked).toBeGreaterThanOrEqual(5)
})

const d1Auth = withDefaults({
  name: "app",
  database: "d1",
  orm: "effect-sql",
  auth: "better-auth",
  extras: [],
})

/** Generates `config` into a temp dir, lets `prepare` change it, then adds `ids`. */
const addLater = (
  config: StackConfig,
  ids: string[],
  prepare: (dir: string) => void = () => {},
) => {
  const tmp = mkdtempSync(join(tmpdir(), "efforge-dashboard-"))
  const dir = join(tmp, "app")
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* writeTree(dir, yield* generate(config, yield* loadAddons(templates)))
      prepare(dir)
      const result = yield* addAddons(dir, ids, { overwrite: false, dryRun: false, install: false })
      return { tmp, dir, result }
    }).pipe(Effect.provide(NodeServices.layer)),
  )
}

it("adding realtime later adds its card to the dashboard", async () => {
  const { tmp, dir, result } = await addLater(d1Auth, ["realtime"])
  try {
    const read = (file: string) => readFileSync(join(dir, file), "utf8")
    const tree: Tree = new Map(
      ["registry.ts", "runtime.tsx", "database.tsx", "auth.tsx", "realtime.tsx"]
        .map((f) => `${CARDS_DIR}${f}`)
        .filter((f) => existsSync(join(dir, f)))
        .map((f) => [f, read(f)]),
    )
    expect(registered(tree)).toEqual(["runtime", "database", "auth", "realtime"])
    expectModules(tree, "after add")
    expect(existsSync(join(dir, "apps/web/src/server/realtime-demo.ts"))).toBe(true)
    expect(rendersRegistry(read(DASHBOARD))).toBe(true)
    expect(result.notes).toEqual([])
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

// add-on, its card's export, and the server file only the card uses
const laterCards: ReadonlyArray<readonly [string, string, string]> = [
  ["workflows", "workflows", "apps/web/src/server/workflows-demo.ts"],
  ["ai/effect-ai-byok", "ai", "apps/web/src/server/ai-demo.ts"],
  ["browser", "browser", "apps/web/src/server/browser-demo.ts"],
]

for (const [addon, card, server] of laterCards)
  it(`adding ${addon} later adds its card to the dashboard`, async () => {
    const { tmp, dir, result } = await addLater(d1Auth, [addon])
    try {
      const read = (file: string) => readFileSync(join(dir, file), "utf8")
      const tree: Tree = new Map(
        ["registry.ts", "runtime.tsx", "database.tsx", "auth.tsx", `${card}.tsx`]
          .map((f) => `${CARDS_DIR}${f}`)
          .map((f) => [f, read(f)]),
      )
      expect(registered(tree)).toEqual(["runtime", "database", "auth", card])
      expectModules(tree, `after add ${addon}`)
      expect(read(server)).toContain(".middleware([requireSession])")
      expect(result.notes).toEqual([])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

it("a project without a card registry (before efforge 0.3) gets the add-on without its card", async () => {
  const { tmp, dir, result } = await addLater(d1Auth, ["realtime"], (d) =>
    rmSync(join(d, REGISTRY_FILE)),
  )
  try {
    expect(result.notes).toEqual([expect.stringMatching(/^No dashboard card for Realtime: /)])
    // the service, its layer and its test are there; the card and what only the card uses are not
    expect(existsSync(join(dir, "packages/core/src/realtime.ts"))).toBe(true)
    expect(readFileSync(join(dir, "apps/web/src/server/layers.ts"), "utf8")).toContain(
      "RealtimeLive",
    )
    expect(existsSync(join(dir, `${CARDS_DIR}realtime.tsx`))).toBe(false)
    expect(existsSync(join(dir, "apps/web/src/server/realtime-demo.ts"))).toBe(false)
    expect(existsSync(join(dir, REGISTRY_FILE))).toBe(false)
    expect(result.written).not.toContain(REGISTRY_FILE)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

// A real 0.2.0 project (test/fixtures/v0.2.0), on an auth stack: no registry, so the realtime card
// unit, its session guard included, is skipped as a whole, and everything else is added.
const v020 = new URL("fixtures/v0.2.0/d1-effect-sql-auth", import.meta.url).pathname

it("add realtime on a 0.2.0 auth project succeeds without the card, and says so", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "efforge-dashboard-"))
  const dir = join(tmp, "old")
  cpSync(v020, dir, { recursive: true })
  try {
    const before = readFileSync(join(dir, DASHBOARD), "utf8")
    const result = await Effect.runPromise(
      addAddons(dir, ["realtime"], { overwrite: false, dryRun: false, install: false }).pipe(
        Effect.provide(NodeServices.layer),
      ),
    )
    expect(readFileSync(join(dir, DASHBOARD), "utf8")).toBe(before)
    expect(readFileSync(join(dir, "apps/web/src/server/layers.ts"), "utf8")).toContain(
      "RealtimeLive",
    )
    for (const f of [`${CARDS_DIR}realtime.tsx`, "apps/web/src/server/realtime-demo.ts"])
      expect(existsSync(join(dir, f)), f).toBe(false)
    expect(result.notes).toEqual([expect.stringMatching(/^No dashboard card for Realtime: /)])
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
