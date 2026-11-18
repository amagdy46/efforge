import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeFileSystem, NodeServices } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect, type FileSystem, Path } from "effect"
import { loadAddons } from "../src/addon.ts"
import { addAddons } from "../src/commands/add.ts"
import { generate } from "../src/generate.ts"
import { validate } from "../src/rules.ts"
import { type StackConfig, withDefaults } from "../src/stack.ts"
import { writeTree } from "../src/write.ts"

// Add-on demos (realtime today) land in components/widgets.tsx, so every page that replaces the
// dashboard has to keep rendering that list, or the demos silently disappear.

const templates = new URL("../templates", import.meta.url).pathname
const DASHBOARD = "apps/web/src/routes/app/index.tsx"

const run = <A, E>(eff: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.runPromise(eff.pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Path.layer)))

const rendersWidgets = (source: string) =>
  /import \{ widgets \} from "@\/components\/widgets"/.test(source) && source.includes("{widgets}")

it("every add-on file that replaces the dashboard renders the widgets", async () => {
  const addons = await run(loadAddons(templates))
  const dashboards = [...addons.values()].flatMap(({ manifest, dir }) =>
    manifest.files
      .filter((f) => f.target === DASHBOARD)
      .map((f) => ({ id: manifest.id, path: join(dir, f.path) })),
  )
  // base, both ORMs and both auth options (orgs reuses the better-auth page)
  expect(dashboards.length).toBeGreaterThanOrEqual(5)
  for (const d of dashboards)
    expect(rendersWidgets(readFileSync(d.path, "utf8")), `${d.id}: ${d.path}`).toBe(true)
})

const combos: StackConfig[] = (["none", "postgres", "d1"] as const).flatMap((database) =>
  (["none", "drizzle", "effect-sql"] as const).flatMap((orm) =>
    (["none", "better-auth", "better-auth-orgs"] as const).map((auth) =>
      withDefaults({ name: "app", database, orm, auth, extras: ["realtime"] }),
    ),
  ),
)

it("the realtime demo reaches the dashboard on every database, ORM and auth", async () => {
  const addons = await run(loadAddons(templates))
  let checked = 0
  for (const config of combos) {
    const valid = await Effect.runPromise(Effect.result(validate(config)))
    if (valid._tag === "Failure") continue
    const tree = await run(generate(config, addons))
    const where = `${config.database}/${config.orm}/${config.auth}`
    expect(tree.get("apps/web/src/components/widgets.tsx"), where).toContain("<RealtimeDemo")
    expect(rendersWidgets(tree.get(DASHBOARD) ?? ""), where).toBe(true)
    checked++
  }
  expect(checked).toBeGreaterThanOrEqual(5)
})

it("adding realtime later shows it on an auth + database dashboard", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "efforge-dashboard-"))
  const dir = join(tmp, "app")
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const config = withDefaults({
          name: "app",
          database: "d1",
          orm: "effect-sql",
          auth: "better-auth",
          extras: [],
        })
        yield* writeTree(dir, yield* generate(config, yield* loadAddons(templates)))
        yield* addAddons(dir, ["realtime"], { overwrite: false, dryRun: false, install: false })
      }).pipe(Effect.provide(NodeServices.layer)),
    )
    expect(rendersWidgets(readFileSync(join(dir, DASHBOARD), "utf8"))).toBe(true)
    expect(readFileSync(join(dir, "apps/web/src/components/widgets.tsx"), "utf8")).toContain(
      "<RealtimeDemo",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
