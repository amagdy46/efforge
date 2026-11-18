import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { afterEach, expect, it } from "vitest"
import { parseDocument } from "yaml"
import { type LoadedAddon, loadAddons } from "../src/addon.ts"
import { defaultTemplatesDir } from "../src/commands/create.ts"
import { readManifest } from "../src/commands/add.ts"
import { generate } from "../src/generate.ts"
import { hash, renderManifest } from "../src/manifest.ts"
import { type StackConfig, withDefaults } from "../src/stack.ts"
import { checkUpgrade, type UpgradeReport } from "../src/upgrade.ts"
import { effectVersion, pnpmVersion } from "../src/versions.ts"

// `upgrade --check`, against projects broken in exactly one way each: a fresh project has nothing
// to do; each change below shows up in its own bucket, and `drifted` follows the documented rule.

const fixture = new URL("fixtures/v0.2.0/d1-effect-sql-auth", import.meta.url).pathname
const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

const run = <A>(eff: Effect.Effect<A, unknown>) => Effect.runPromise(eff)

let addons: ReadonlyMap<string, LoadedAddon> | undefined
const loaded = async () =>
  (addons ??= await run(loadAddons(defaultTemplatesDir).pipe(Effect.provide(NodeServices.layer))))

/** A project as `create --no-install` writes it, in a temp dir. */
const project = async (partial: Partial<StackConfig> = {}): Promise<string> => {
  const dir = mkdtempSync(join(tmpdir(), "efforge-upgrade-"))
  roots.push(dir)
  const stack = withDefaults({
    name: "my-app",
    database: "d1",
    orm: "effect-sql",
    auth: "better-auth",
    ...partial,
  })
  const tree = await run(generate(stack, await loaded()).pipe(Effect.provide(NodeServices.layer)))
  for (const [file, content] of tree) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), content)
  }
  return dir
}

const check = async (dir: string, diff = false): Promise<UpgradeReport> =>
  run(
    Effect.gen(function* () {
      const m = yield* readManifest(dir)
      return yield* checkUpgrade(dir, m, yield* Effect.promise(loaded), { diff })
    }).pipe(Effect.provide(NodeServices.layer)),
  )

const edit = (dir: string, file: string, f: (text: string) => string) =>
  writeFileSync(join(dir, file), f(readFileSync(join(dir, file), "utf8")))

const statusOf = (r: UpgradeReport, path: string) => r.files.find((f) => f.path === path)?.status

/** Records `content` as what efforge wrote for `file` (an older template), and puts it on disk. */
const olderTemplate = (dir: string, file: string, content: string) => {
  writeFileSync(join(dir, file), content)
  const text = readFileSync(join(dir, "efforge.jsonc"), "utf8")
  const m = JSON.parse(text.slice(text.indexOf("{")))
  m.files[file] = hash(content)
  writeFileSync(join(dir, "efforge.jsonc"), renderManifest(m))
}

it("a project this efforge just made has nothing to do", async () => {
  const r = await check(await project())
  expect(r.drifted).toBe(false)
  expect(r.steps).toEqual([])
  expect(r.patch).toBe("")
  expect(r.guards.every((g) => g.ok)).toBe(true)
  expect(r.pins.every((p) => p.status === "same")).toBe(true)
  expect(new Set(r.files.map((f) => f.status))).toEqual(new Set(["current"]))
  expect(r.seams).toEqual([])
})

it("the same holds for an Alchemy stack with every extra", async () => {
  const r = await check(
    await project({
      database: "postgres",
      orm: "drizzle",
      auth: "better-auth-orgs",
      infra: "alchemy",
      ai: "effect-ai-byok",
      extras: ["workflows", "realtime", "browser", "storage", "email"],
    }),
  )
  expect(r.drifted).toBe(false)
  expect(r.steps).toEqual([])
})

it("the 0.2.0 fixture: both guards, the Effect set behind as one, the old dashboard to refresh", async () => {
  const dir = mkdtempSync(join(tmpdir(), "efforge-upgrade-"))
  roots.push(dir)
  cpSync(fixture, dir, { recursive: true })
  const r = await check(dir)
  expect(r.drifted).toBe(true)
  expect(r.project).toMatchObject({ efforgeVersion: "0.2.0", status: "behind" })
  expect(r.guards.map((g) => [g.id, g.ok])).toEqual([
    ["effect-overrides", false],
    ["package-manager", false],
  ])
  const effect = r.pins.find((p) => p.name === "effect")
  expect(effect).toMatchObject({ project: "4.0.5", efforge: effectVersion, status: "behind" })
  expect(effect?.set).toBe("effect")
  expect(r.sets.find((s) => s.id === "effect")?.packages).toContain("@effect/sql-d1")
  expect(r.pins.find((p) => p.name === "pnpm")).toMatchObject({ project: "12.4.2" })
  expect(statusOf(r, "apps/web/src/routes/app/index.tsx")).toBe("refresh")
  // the fixture kept only some files: the rest were "deleted", which is never drift
  expect(statusOf(r, "turbo.json")).toBe("deleted")
  const ids = r.steps.map((s) => s.id)
  expect(ids.slice(0, 4)).toEqual(["patch", "effect-overrides", "package-manager", "pins"])
  expect(ids.at(-1)).toBe("gate")
  const overrides = r.steps.find((s) => s.id === "effect-overrides")
  expect(overrides?.lines).toContain(`"@effect/sql-*": ${effectVersion}`)
  expect(r.steps.find((s) => s.id === "package-manager")?.byAdd).toBe(true)
  // the patch holds the guard at the version the pins move to
  expect(r.patch).toContain(`+  "@effect/sql-*": ${effectVersion}`)
  expect(r.patch).toContain(`+  "packageManager": "pnpm@${pnpmVersion}"`)
})

it("a file you edited, whose template didn't change, is yours and not drift", async () => {
  const dir = await project()
  edit(dir, "apps/web/src/routes/app.tsx", (t) => `${t}// mine\n`)
  const r = await check(dir)
  expect(statusOf(r, "apps/web/src/routes/app.tsx")).toBe("yours")
  expect(r.drifted).toBe(false)
})

it("an unedited file whose template moved on is refresh, and the patch fixes it", async () => {
  const dir = await project()
  olderTemplate(dir, "apps/web/src/routes/app.tsx", "// what an older efforge wrote\n")
  const r = await check(dir, true)
  expect(statusOf(r, "apps/web/src/routes/app.tsx")).toBe("refresh")
  expect(r.files.find((f) => f.path === "apps/web/src/routes/app.tsx")?.diff).toContain(
    "-// what an older efforge wrote",
  )
  expect(r.drifted).toBe(true)
  expect(r.steps.find((s) => s.id === "refresh")?.files).toEqual(["apps/web/src/routes/app.tsx"])
  // applied with git, the project has nothing left to do, and efforge.jsonc records the new hash
  spawnSync("git", ["init", "-q"], { cwd: dir })
  const applied = spawnSync("git", ["apply"], { cwd: dir, input: r.patch, encoding: "utf8" })
  expect(applied.status, applied.stderr).toBe(0)
  const after = await check(dir)
  expect(after.drifted).toBe(false)
  expect(statusOf(after, "apps/web/src/routes/app.tsx")).toBe("current")
})

it("a file both you and the template changed is review, with a diff but no patch", async () => {
  const dir = await project()
  olderTemplate(dir, "apps/web/src/routes/app.tsx", "// what an older efforge wrote\n")
  edit(dir, "apps/web/src/routes/app.tsx", (t) => `${t}// and my edit\n`)
  const r = await check(dir, true)
  expect(statusOf(r, "apps/web/src/routes/app.tsx")).toBe("review")
  expect(r.drifted).toBe(false)
  expect(r.patch).not.toContain("app.tsx")
  expect(r.steps.find((s) => s.id === "review")?.files).toEqual(["apps/web/src/routes/app.tsx"])
})

it("a file efforge edits in place that differs from today's is differs, not drift", async () => {
  const dir = await project()
  edit(dir, "apps/web/src/server/layers.ts", (t) => `${t}// mine\n`)
  const r = await check(dir)
  expect(statusOf(r, "apps/web/src/server/layers.ts")).toBe("differs")
  expect(r.drifted).toBe(false)
})

it("a deleted binding is a seam, with the exact lines", async () => {
  const dir = await project()
  edit(dir, "wrangler.jsonc", (t) =>
    t.replace(/"d1_databases": \[[\s\S]*?\]/, '"d1_databases": []'),
  )
  const r = await check(dir)
  expect(r.drifted).toBe(true)
  const seam = r.seams.find((s) => s.file === "wrangler.jsonc")
  expect(seam?.missing).toEqual(["binding in d1_databases (database/d1)"])
  expect(seam?.diff).toMatch(/^\+\s+"binding": "DB"/m)
})

it("a missing AGENTS.md section is a seam", async () => {
  const dir = await project()
  edit(dir, "AGENTS.md", (t) => t.replace(/<!-- efforge:section:auth -->[\s\S]*?(?=<!--)/, ""))
  const r = await check(dir)
  expect(r.seams.find((s) => s.file === "AGENTS.md")?.missing).toEqual([
    "section auth (auth/better-auth)",
  ])
})

it("a layer removed from layers.ts is a seam", async () => {
  const dir = await project()
  edit(dir, "apps/web/src/server/layers.ts", (t) => t.replace(/^\s*AuthLive,\n/m, ""))
  const r = await check(dir)
  expect(r.seams.find((s) => s.file === "apps/web/src/server/layers.ts")?.missing).toContain(
    "layer AuthLive (auth/better-auth)",
  )
})

it("one Effect package downgraded: behind, and its set is half moved", async () => {
  const dir = await project()
  edit(dir, "pnpm-workspace.yaml", (t) => {
    const doc = parseDocument(t)
    doc.setIn(["catalog", "@effect/sql-d1"], "4.0.5")
    return doc.toString()
  })
  const r = await check(dir)
  expect(r.pins.find((p) => p.name === "@effect/sql-d1")?.status).toBe("behind")
  expect(r.sets).toMatchObject([{ id: "effect", split: true }])
  expect(r.drifted).toBe(true)
})

it("a packageManager below 12.17 fails the guard; an ahead pin alone is not drift", async () => {
  const dir = await project()
  edit(dir, "package.json", (t) => t.replace(`pnpm@${pnpmVersion}`, "pnpm@12.4.2"))
  const low = await check(dir)
  expect(low.guards.find((g) => g.id === "package-manager")?.ok).toBe(false)
  expect(low.drifted).toBe(true)
  edit(dir, "package.json", (t) => t.replace("pnpm@12.4.2", "pnpm@99.0.0"))
  const ahead = await check(dir)
  expect(ahead.pins.find((p) => p.name === "pnpm")?.status).toBe("ahead")
  expect(ahead.drifted).toBe(false)
})

it("removed overrides fail the guard, and the step names efforge add", async () => {
  const dir = await project()
  edit(dir, "pnpm-workspace.yaml", (t) => {
    const doc = parseDocument(t)
    doc.setIn(["overrides"], { vite: "catalog:" })
    return doc.toString()
  })
  const r = await check(dir)
  expect(r.guards.find((g) => g.id === "effect-overrides")).toMatchObject({ ok: false })
  expect(r.steps.find((s) => s.id === "effect-overrides")?.byAdd).toBe(true)
})

it("a script that differs is reported, not patched", async () => {
  const dir = await project()
  edit(dir, "package.json", (t) =>
    t.replace('"check": "effect-tsgo vp check"', '"check": "vp check"'),
  )
  const r = await check(dir)
  expect(r.scripts).toEqual([
    { file: "package.json", name: "check", yours: "vp check", efforge: "effect-tsgo vp check" },
  ])
  expect(r.drifted).toBe(false)
  expect(r.patch).toBe("")
})

it("a project newer than this CLI says so and points at @latest", async () => {
  const dir = await project()
  edit(dir, "efforge.jsonc", (t) =>
    t.replace(/"efforgeVersion": "[^"]*"/, '"efforgeVersion": "99.0.0"'),
  )
  const r = await check(dir)
  expect(r.project.status).toBe("ahead")
  expect(r.warnings[0]).toContain("@latest upgrade --check")
  expect(r.steps[0]?.id).toBe("newer-cli")
})
