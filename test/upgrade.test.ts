import { spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { afterEach, expect, it, vi } from "vitest"
import { parseDocument } from "yaml"
import { type LoadedAddon, loadAddons } from "../src/addon.ts"
import { runWith } from "../src/cli.ts"
import { addAddons, readManifest } from "../src/commands/add.ts"
import { defaultTemplatesDir } from "../src/commands/create.ts"
import { DoctorProbe, liveProbe } from "../src/doctor.ts"
import { generate } from "../src/generate.ts"
import { releases } from "../src/history.ts"
import { hash, renderManifest } from "../src/manifest.ts"
import { PromptIOLive } from "../src/prompts/navigable.ts"
import { type StackConfig, withDefaults } from "../src/stack.ts"
import { pinStatus, planUpgrade, type UpgradeReport } from "../src/upgrade.ts"
import { efforgeVersion, effectVersion, pnpmVersion, versions } from "../src/versions.ts"
import { recordingSpawner } from "./recordingSpawner.ts"

// `upgrade`, against projects changed in exactly one way each. Two rules hold throughout: what
// efforge applies leaves the project consistent (every import it touches still resolves, and a
// second run has nothing to apply), and it never undoes the owner's work.

const fixture = new URL("fixtures/v0.2.0/d1-effect-sql-auth", import.meta.url).pathname
// each test renders a project and plans an upgrade; under a full parallel run that takes a while
vi.setConfig({ testTimeout: 60_000 })

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

const run = <A>(eff: Effect.Effect<A, unknown>) => Effect.runPromise(eff)

let addons: ReadonlyMap<string, LoadedAddon> | undefined
const loaded = async () =>
  (addons ??= await run(loadAddons(defaultTemplatesDir).pipe(Effect.provide(NodeServices.layer))))

const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "efforge-upgrade-"))
  roots.push(dir)
  return dir
}

/** A project as `create --no-install` writes it, in a temp dir. */
const project = async (partial: Partial<StackConfig> = {}): Promise<string> => {
  const dir = temp()
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

const bin = (args: string) => `npx -y create-efforge ${args}`

const check = async (dir: string, diff = false): Promise<UpgradeReport> =>
  run(
    Effect.gen(function* () {
      const m = yield* readManifest(dir)
      return yield* planUpgrade(dir, m, yield* Effect.promise(loaded), {
        diff,
        bin,
        here: (c) => c,
      })
    }).pipe(Effect.provide(NodeServices.layer)),
  )

/** What `upgrade` writes, without the install. */
const apply = (dir: string, r: UpgradeReport) => {
  for (const f of r.removes) rmSync(join(dir, f), { force: true })
  for (const [f, text] of r.changes) {
    mkdirSync(dirname(join(dir, f)), { recursive: true })
    writeFileSync(join(dir, f), text)
  }
}

const read = (dir: string, file: string) => readFileSync(join(dir, file), "utf8")
const edit = (dir: string, file: string, f: (text: string) => string) =>
  writeFileSync(join(dir, file), f(read(dir, file)))

const statusOf = (r: UpgradeReport, path: string) => r.files.find((f) => f.path === path)?.status

/** Records `content` as what efforge wrote for `file` (an older template), and puts it on disk. */
const olderTemplate = (dir: string, file: string, content: string) => {
  writeFileSync(join(dir, file), content)
  const text = read(dir, "efforge.jsonc")
  const m = JSON.parse(text.slice(text.indexOf("{")))
  m.files[file] = hash(content)
  writeFileSync(join(dir, "efforge.jsonc"), renderManifest(m))
}

/**
 * The invariant: after applying, nothing is broken that efforge could see (no import of a missing
 * file, name or region), and a second run has nothing to apply.
 */
const consistent = async (dir: string, before: UpgradeReport) => {
  const again = await check(dir)
  const broken = (r: UpgradeReport) =>
    r.needsAction
      .filter((n) => n.id === "missing-seam")
      .map((n) => n.message.replace(/ upgrade adds it\.$/, ""))
  // a project that didn't build is no further from building
  expect(broken(again).filter((b) => !broken(before).includes(b))).toEqual([])
  expect([...again.changes.keys()]).toEqual([])
  expect([...again.removes]).toEqual([])
  return again
}

it("a project this efforge just made has nothing to apply", async () => {
  const r = await check(await project())
  expect(r.status).toBe("current")
  expect(r.needsAction).toEqual([])
  expect(r.steps).toEqual([])
  expect(r.changes.size).toBe(0)
  expect(r.kept).toEqual([])
  expect(r.guards.every((g) => g.ok)).toBe(true)
  expect(r.pins.every((p) => p.status === "same")).toBe(true)
  expect(new Set(r.files.map((f) => f.status))).toEqual(new Set(["current"]))
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
  expect(r.status).toBe("current")
  expect(r.steps).toEqual([])
})

// ruling 5: add appends where create orders by slot; that is no difference
it("after efforge's own add, nothing differs: structure, not text", async () => {
  const dir = await project({ extras: ["storage"] })
  await run(
    addAddons(dir, ["extras/email", "ai/effect-ai-byok"], {
      overwrite: false,
      dryRun: false,
      install: false,
    }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, recordingSpawner([])))),
  )
  const r = await check(dir)
  expect(r.files.filter((f) => f.status !== "current")).toEqual([])
  expect(r.kept).toEqual([])
  expect(r.status).toBe("current")
})

// ruling 1, the fast case: the committed 0.2.0 fixture, as it is and with the owner's edits
it("the 0.2.0 fixture: one consistent set, applied, and nothing left to apply", async () => {
  const dir = temp()
  cpSync(fixture, dir, { recursive: true })
  const r = await check(dir)
  expect(r.status).toBe("needs-action")
  // the fixture keeps only some files, so imports of the rest are broken as it is
  const guards = r.needsAction.filter((n) => n.id !== "missing-seam")
  expect(guards.map((n) => n.id)).toEqual(["effect-overrides", "package-manager"])
  expect(guards.every((n) => n.fix === bin("upgrade"))).toBe(true)
  expect(r.project).toMatchObject({ efforgeVersion: "0.2.0", status: "behind" })
  expect(r.pins.find((p) => p.name === "effect")).toMatchObject({
    project: "4.0.5",
    efforge: effectVersion,
    status: "behind",
  })
  expect(r.steps[0]).toMatchObject({ id: "upgrade", command: bin("upgrade") })
  expect(r.steps[0]?.covers).toEqual(
    expect.arrayContaining([
      "effect-overrides",
      "package-manager",
      "pins",
      "refresh",
      "manifest",
      "install",
    ]),
  )
  expect(r.steps.at(-1)?.id).toBe("gate")
  apply(dir, r)
  const ws = read(dir, "pnpm-workspace.yaml")
  expect(ws).toContain(`"@effect/sql-*": ${effectVersion}`)
  expect(read(dir, "package.json")).toContain(`"packageManager": "pnpm@${pnpmVersion}"`)
  expect(read(dir, "efforge.jsonc")).toContain(`"efforgeVersion": "${efforgeVersion}"`)
  // the new dashboard shows layers.ts's card region; layers.ts was efforge's own, so it was refreshed
  if (r.changes.has("apps/web/src/routes/app/index.tsx"))
    expect(read(dir, "apps/web/src/server/layers.ts")).toContain("// #region card")
  const after = await consistent(dir, r)
  expect(after.needsAction.filter((n) => n.id !== "missing-seam")).toEqual([])
})

it("the 0.2.0 fixture with a layer of the owner's and an edited dashboard: both kept, the rest consistent", async () => {
  const dir = temp()
  cpSync(fixture, dir, { recursive: true })
  edit(dir, "apps/web/src/server/layers.ts", (t) =>
    t
      .replace(
        'import { AuthLive } from "./auth-live"',
        'import { AuthLive } from "./auth-live"\nimport { BillingLive } from "./billing"',
      )
      .replace("  AuthLive,\n", "  AuthLive,\n  BillingLive,\n"),
  )
  writeFileSync(
    join(dir, "apps/web/src/server/billing.ts"),
    'import { Layer } from "effect"\n\nexport const BillingLive = Layer.empty\n',
  )
  edit(dir, "apps/web/src/routes/app/index.tsx", (t) =>
    t.replace(">Dashboard<", ">Acme dashboard<"),
  )
  const layers = read(dir, "apps/web/src/server/layers.ts")
  const dashboard = read(dir, "apps/web/src/routes/app/index.tsx")
  const r = await check(dir)
  expect(statusOf(r, "apps/web/src/routes/app/index.tsx")).toBe("review")
  expect(r.kept.map((k) => k.path)).toContain("apps/web/src/routes/app/index.tsx")
  // never "efforge's version" of a file that holds the owner's layer
  const planned = r.changes.get("apps/web/src/server/layers.ts")
  if (planned !== undefined) expect(planned).toContain("BillingLive")
  apply(dir, r)
  expect(read(dir, "apps/web/src/routes/app/index.tsx")).toBe(dashboard)
  const now = read(dir, "apps/web/src/server/layers.ts")
  expect(now.replace(/^\/\/ #(region card|endregion)\n/gm, "")).toBe(layers)
  await consistent(dir, r)
})

it("a new file that needs a region of a file you changed gets it by transform, with your edit kept", async () => {
  const dir = await project()
  // an older dashboard, as efforge wrote it, and layers.ts without the region but with your layer
  olderTemplate(dir, "apps/web/src/routes/app/index.tsx", 'export const Route = "old dashboard"\n')
  edit(dir, "apps/web/src/server/layers.ts", (t) =>
    t
      .replace(/^\/\/ #(region card|endregion)\n/gm, "")
      .replace("  AuthLive,\n", "  AuthLive,\n  // BillingLive, next quarter\n"),
  )
  const r = await check(dir)
  expect(statusOf(r, "apps/web/src/routes/app/index.tsx")).toBe("refresh")
  const layers = r.changes.get("apps/web/src/server/layers.ts") as string
  expect(layers).toContain("// #region card")
  expect(layers).toContain("// BillingLive, next quarter")
  expect(r.seams.find((s) => s.file === "apps/web/src/server/layers.ts")?.missing.join()).toContain(
    "region card",
  )
  apply(dir, r)
  await consistent(dir, r)
})

it("the region can't be added where something of yours sits inside it: the file that needs it is held, with the lines", async () => {
  const dir = await project()
  olderTemplate(dir, "apps/web/src/routes/app/index.tsx", 'export const Route = "old dashboard"\n')
  edit(dir, "apps/web/src/server/layers.ts", (t) =>
    t.replace(/^\/\/ #(region card|endregion)\n/gm, ""),
  )
  // AppLayer split in two, with your own const between
  edit(dir, "apps/web/src/server/layers.ts", (t) =>
    t.replace("export const AppLayer", "export const Secret = 1\nexport const AppLayer"),
  )
  edit(dir, "apps/web/src/server/layers.ts", (t) => `${t}\nexport const Mine = 2\n`)
  const before = read(dir, "apps/web/src/server/layers.ts")
  const r = await check(dir)
  apply(dir, r)
  // either the region went around AppLayer alone, or what needs it is held with the reason
  const after = read(dir, "apps/web/src/server/layers.ts")
  if (after === before)
    expect(r.kept.find((k) => k.path === "apps/web/src/routes/app/index.tsx")?.status).toBe("held")
  else expect(after).toContain("export const Secret = 1")
  await consistent(dir, r)
})

it("an efforge file you import, whose new version drops what you use, is held with the reason", async () => {
  const dir = await project()
  // an older greeting.ts, as efforge wrote it, exporting what your file imports
  olderTemplate(
    dir,
    "apps/web/src/server/greeting.ts",
    'export const getGreeting = () => "hello"\n',
  )
  writeFileSync(
    join(dir, "apps/web/src/server/mine.ts"),
    'import { getGreeting } from "./greeting"\n\nexport const twice = () => getGreeting() + getGreeting()\n',
  )
  const r = await check(dir)
  const held = r.files.find((f) => f.path === "apps/web/src/server/greeting.ts")
  expect(held?.status).toBe("refresh")
  expect(held?.held?.reason).toContain("apps/web/src/server/mine.ts imports `getGreeting`")
  expect(r.changes.has("apps/web/src/server/greeting.ts")).toBe(false)
  expect(r.kept.find((k) => k.path === "apps/web/src/server/greeting.ts")?.status).toBe("held")
  apply(dir, r)
  await consistent(dir, r)
})

it("an unedited file whose template moved is refreshed, its hash recorded", async () => {
  const dir = await project()
  olderTemplate(dir, "apps/web/src/routes/app.tsx", "// what an older efforge wrote\n")
  const r = await check(dir, true)
  expect(statusOf(r, "apps/web/src/routes/app.tsx")).toBe("refresh")
  expect(r.files.find((f) => f.path === "apps/web/src/routes/app.tsx")?.diff).toContain(
    "-// what an older efforge wrote",
  )
  expect(r.status).toBe("behind")
  apply(dir, r)
  const after = await consistent(dir, r)
  expect(statusOf(after, "apps/web/src/routes/app.tsx")).toBe("current")
})

it("a file both you and the template changed is review: kept, with what the change is for", async () => {
  const dir = await project()
  olderTemplate(dir, "apps/web/src/routes/app/index.tsx", "// what an older efforge wrote\n")
  edit(dir, "apps/web/src/routes/app/index.tsx", (t) => `${t}// and my edit\n`)
  const r = await check(dir, true)
  expect(statusOf(r, "apps/web/src/routes/app/index.tsx")).toBe("review")
  expect(r.changes.has("apps/web/src/routes/app/index.tsx")).toBe(false)
  expect(r.status).toBe("current")
  expect(r.kept[0]?.reason).toContain("one card per capability")
})

// ruling 6 (finding 6): a file taken whole from efforge gets efforge's hash
it("a file equal to today's template but recorded with an older hash is recorded as efforge's", async () => {
  const dir = await project()
  const text = read(dir, "apps/web/src/routes/app.tsx")
  olderTemplate(dir, "apps/web/src/routes/app.tsx", "// older\n")
  writeFileSync(join(dir, "apps/web/src/routes/app.tsx"), text)
  const r = await check(dir)
  expect(statusOf(r, "apps/web/src/routes/app.tsx")).toBe("current")
  expect(r.changes.get("efforge.jsonc")).toContain(`"apps/web/src/routes/app.tsx": "${hash(text)}"`)
})

// finding 13
it("CRLF line endings don't make every file yours", async () => {
  const dir = await project()
  edit(dir, "apps/web/src/routes/app.tsx", (t) => t.replace(/\n/g, "\r\n"))
  const r = await check(dir)
  expect(statusOf(r, "apps/web/src/routes/app.tsx")).toBe("current")
  expect(r.status).toBe("current")
})

// ruling 4: owner choices are not drift
it("a pin you hold (with its set) is yours: never moved, never counted", async () => {
  const dir = await project()
  edit(dir, "pnpm-workspace.yaml", (t) =>
    t
      .replace(`  react: ${versions.react}`, "  # held for the date picker\n  react: 19.3.0")
      .replace(`  react-dom: ${versions["react-dom"]}`, "  react-dom: 19.3.0"),
  )
  const r = await check(dir)
  expect(r.pins.find((p) => p.name === "react")?.status).toBe("yours")
  expect(r.sets.find((s) => s.id === "react")?.split).toBe(false)
  expect(r.status).toBe("current")
  expect(r.changes.has("pnpm-workspace.yaml")).toBe(false)
})

it("one pin of a set yours: efforge holds the rest of the set rather than split it", async () => {
  const dir = await project()
  edit(dir, "pnpm-workspace.yaml", (t) =>
    t
      .replace(`  react: ${versions.react}`, "  react: 19.3.0")
      .replace(`  react-dom: ${versions["react-dom"]}`, "  react-dom: 19.2.0"),
  )
  edit(dir, "efforge.jsonc", (t) =>
    t.replace(/"efforgeVersion": "[^"]*"/, '"efforgeVersion": "0.2.0"'),
  )
  const r = await check(dir)
  expect(r.pins.find((p) => p.name === "react")?.status).toBe("yours")
  expect(r.needsAction.filter((n) => n.id === "split-set")).toEqual([])
  const ws = parseDocument(
    r.changes.get("pnpm-workspace.yaml") ?? read(dir, "pnpm-workspace.yaml"),
  ).toJS()
  expect(ws.catalog.react).toBe("19.3.0")
})

it("efforge's own pins of a set at two releases' versions: half moved, needs action, upgrade moves them as one", async () => {
  const dir = await project({ orm: "drizzle" })
  edit(dir, "pnpm-workspace.yaml", (t) =>
    t.replace(`drizzle-kit: ${versions["drizzle-kit"]}`, "drizzle-kit: 1.0.0-rc.5-5935859"),
  )
  edit(dir, "efforge.jsonc", (t) =>
    t.replace(/"efforgeVersion": "[^"]*"/, '"efforgeVersion": "0.2.0"'),
  )
  const r = await check(dir)
  const split = r.needsAction.find((n) => n.id === "split-set")
  expect(split?.fix).toBe(bin("upgrade"))
  expect(split?.message).toContain("drizzle-kit 1.0.0-rc.5-5935859")
  apply(dir, r)
  expect((await check(dir)).needsAction.filter((n) => n.id === "split-set")).toEqual([])
})

it("a layer replaced by yours, a renamed binding, a removed AGENTS.md section: none put back", async () => {
  const dir = await project()
  edit(dir, "apps/web/src/server/layers.ts", (t) =>
    t
      .replace('import { AuthLive } from "./auth-live"', 'import { MyAuthLive } from "./my-auth"')
      .replace("  AuthLive,\n", "  MyAuthLive,\n"),
  )
  edit(dir, "wrangler.jsonc", (t) => t.replace('"binding": "DB"', '"binding": "MAIN_DB"'))
  edit(dir, "AGENTS.md", (t) => t.replace(/<!-- efforge:section:auth -->[\s\S]*?(?=<!--)/, ""))
  const r = await check(dir)
  for (const f of ["apps/web/src/server/layers.ts", "wrangler.jsonc", "AGENTS.md"]) {
    expect(r.changes.has(f)).toBe(false)
    expect(["review", "yours"]).toContain(statusOf(r, f))
  }
  expect(r.status).toBe("current")
})

it("a deleted AGENTS.md stays deleted", async () => {
  const dir = await project()
  rmSync(join(dir, "AGENTS.md"))
  const r = await check(dir)
  expect(statusOf(r, "AGENTS.md")).toBe("deleted")
  expect(r.changes.has("AGENTS.md")).toBe(false)
  expect(r.status).toBe("current")
})

it("a script an efforge release wrote moves; one you wrote stays yours", async () => {
  const dir = await project()
  // 0.2.0's check script, as efforge wrote it then
  edit(dir, "package.json", (t) =>
    t.replace('"check": "effect-tsgo vp check"', '"check": "vp check"'),
  )
  edit(dir, "efforge.jsonc", (t) =>
    t.replace(/"efforgeVersion": "[^"]*"/, '"efforgeVersion": "0.2.0"'),
  )
  const r = await check(dir)
  expect(r.scripts).toEqual([
    {
      file: "package.json",
      name: "check",
      yours: "vp check",
      efforge: "effect-tsgo vp check",
      status: "behind",
    },
  ])
  expect(r.changes.get("package.json")).toContain('"check": "effect-tsgo vp check"')
  edit(dir, "package.json", (t) =>
    t.replace('"check": "vp check"', '"check": "vp check && my-check"'),
  )
  const mine = await check(dir)
  expect(mine.scripts[0]?.status).toBe("yours")
  expect(mine.changes.get("package.json") ?? "").not.toContain("effect-tsgo vp check")
})

it("the release history has this efforge, with the pins versions.ts has", () => {
  const entry = releases[efforgeVersion]
  expect(entry, `run node scripts/history.ts for ${efforgeVersion}`).toBeDefined()
  expect(entry?.pins).toEqual(
    Object.fromEntries(Object.entries(versions).toSorted(([a], [b]) => (a < b ? -1 : 1))),
  )
  expect(entry?.pnpm).toBe(pnpmVersion)
})

// ruling 7: which pin efforge wrote, not a semver guess
it("pins: a snapshot or hash-suffixed pre-release a release wrote is behind; one none wrote is yours", () => {
  expect(pinStatus("0.2.0", "drizzle-orm", "1.0.0-rc.5-5935859", "1.0.0-rc.5")).toBe("behind")
  expect(pinStatus("0.2.0", "drizzle-kit", "1.0.0-rc.5-5935859", "1.0.0-rc.5")).toBe("behind")
  expect(pinStatus("0.2.0", "drizzle-orm", "1.0.0-rc.4-de6c356", "1.0.0-rc.5")).toBe("yours")
  expect(pinStatus("0.2.0", "drizzle-orm", "1.0.0-rc.6", "1.0.0-rc.5")).toBe("yours")
  expect(pinStatus(efforgeVersion, "drizzle-orm", "1.0.0-rc.5-5935859", "1.0.0-rc.5")).toBe("yours")
  expect(pinStatus("0.2.0", "drizzle-orm", "1.0.0-rc.5", "1.0.0-rc.5")).toBe("same")
  expect(pinStatus("0.2.0", "left-pad", "1.0.0", undefined)).toBe("unmanaged")
})

it("a 0.2.0 drizzle snapshot pin moves to efforge's with its set", async () => {
  const dir = await project({ orm: "drizzle" })
  edit(dir, "pnpm-workspace.yaml", (t) =>
    t
      .replace(`drizzle-orm: ${versions["drizzle-orm"]}`, "drizzle-orm: 1.0.0-rc.5-5935859")
      .replace(`drizzle-kit: ${versions["drizzle-kit"]}`, "drizzle-kit: 1.0.0-rc.5-5935859"),
  )
  edit(dir, "efforge.jsonc", (t) =>
    t.replace(/"efforgeVersion": "[^"]*"/, '"efforgeVersion": "0.2.0"'),
  )
  const r = await check(dir)
  expect(r.pins.find((p) => p.name === "drizzle-orm")?.status).toBe("behind")
  const ws = parseDocument(r.changes.get("pnpm-workspace.yaml") as string).toJS()
  expect(ws.catalog["drizzle-orm"]).toBe(versions["drizzle-orm"])
  expect(ws.catalog["drizzle-kit"]).toBe(versions["drizzle-kit"])
})

// ruling 8: an install still owed is a step
it("an install still owed is needs action, until pnpm install", async () => {
  const dir = await project()
  mkdirSync(join(dir, "node_modules/.pnpm"), { recursive: true })
  writeFileSync(join(dir, "node_modules/.modules.yaml"), "layoutVersion: 5\n")
  writeFileSync(
    join(dir, "node_modules/.pnpm/lock.yaml"),
    "lockfileVersion: '9.0'\nimporters: {}\n",
  )
  const r = await check(dir)
  expect(r.needsAction.find((n) => n.id === "install")).toMatchObject({ fix: "pnpm install" })
  expect(r.status).toBe("needs-action")
})

// --- the command -------------------------------------------------------------------------------

const cli = async (
  args: ReadonlyArray<string>,
  cwd: string,
  opts: { calls?: string[]; dirty?: string; real?: boolean } = {},
) => {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")))
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")))
  const before = process.cwd()
  process.chdir(cwd)
  process.exitCode = undefined
  try {
    await runWith(args).pipe(
      Effect.provide(
        Layer.mergeAll(
          opts.real === true
            ? NodeServices.layer
            : Layer.merge(
                NodeServices.layer,
                recordingSpawner(opts.calls ?? [], undefined, undefined, undefined, (c) =>
                  c.startsWith("git status") ? opts.dirty : undefined,
                ),
              ),
          PromptIOLive,
          Layer.succeed(DoctorProbe, liveProbe),
        ),
      ),
      Effect.runPromise,
    )
  } finally {
    process.chdir(before)
    vi.restoreAllMocks()
  }
  const exitCode = process.exitCode ?? 0
  process.exitCode = undefined
  return { stdout: out.join("\n"), stderr: err.join("\n"), exitCode }
}

const lowerPnpm = (dir: string) =>
  edit(dir, "package.json", (t) => t.replace(`pnpm@${pnpmVersion}`, "pnpm@12.4.2"))

// ruling 3: two questions, two answers
it("upgrade --check: exit 2 for needs action, 0 for behind, 3 for behind with --strict", async () => {
  const dir = await project()
  expect((await cli(["upgrade", "--check", "--json"], dir)).exitCode).toBe(0)
  olderTemplate(dir, "apps/web/src/routes/app.tsx", "// older\n")
  const behind = await cli(["upgrade", "--check", "--json"], dir)
  expect(JSON.parse(behind.stdout)).toMatchObject({ ok: true, status: "behind", needsAction: [] })
  expect(behind.exitCode).toBe(0)
  expect((await cli(["upgrade", "--check", "--strict", "--json"], dir)).exitCode).toBe(3)
  lowerPnpm(dir)
  const broken = await cli(["upgrade", "--check", "--json"], dir)
  expect(JSON.parse(broken.stdout)).toMatchObject({ status: "needs-action" })
  expect(broken.exitCode).toBe(2)
  // human output leads with what breaks
  const text = (await cli(["upgrade", "--check"], dir)).stdout
  expect(text.split("\n")[0]).toContain("Needs action")
})

// ruling 2: an apply mode efforge owns
it("upgrade applies, installs, records the version; a second run has nothing to apply", async () => {
  const dir = await project()
  lowerPnpm(dir)
  edit(dir, "efforge.jsonc", (t) =>
    t.replace(/"efforgeVersion": "[^"]*"/, '"efforgeVersion": "0.2.0"'),
  )
  const calls: string[] = []
  const r = await cli(["upgrade", "--json"], dir, { calls })
  const doc = JSON.parse(r.stdout)
  expect(doc).toMatchObject({
    ok: true,
    check: false,
    dryRun: false,
    status: "current",
    installed: true,
  })
  expect(doc.efforgeVersion).toEqual({ from: "0.2.0", to: efforgeVersion })
  expect(doc.changed).toEqual(expect.arrayContaining(["efforge.jsonc", "package.json"]))
  expect(calls).toContain("pnpm install --no-frozen-lockfile")
  expect(read(dir, "package.json")).toContain(`pnpm@${pnpmVersion}`)
  expect(read(dir, "efforge.jsonc")).toContain(`"efforgeVersion": "${efforgeVersion}"`)
  expect(r.exitCode).toBe(0)
  const again = JSON.parse((await cli(["upgrade", "--json"], dir)).stdout)
  expect(again).toMatchObject({ created: [], changed: [], removed: [], status: "current" })
})

it("upgrade --dry-run writes nothing; --no-install skips the install", async () => {
  const dir = await project()
  lowerPnpm(dir)
  const before = read(dir, "package.json")
  const dry = JSON.parse((await cli(["upgrade", "--dry-run", "--json"], dir)).stdout)
  expect(dry).toMatchObject({ dryRun: true, changed: expect.arrayContaining(["package.json"]) })
  expect(read(dir, "package.json")).toBe(before)
  const calls: string[] = []
  const r = JSON.parse((await cli(["upgrade", "--no-install", "--json"], dir, { calls })).stdout)
  expect(r.installed).toBe(false)
  expect(calls.filter((c) => c.startsWith("pnpm install"))).toEqual([])
  expect(r.nextSteps[0].command).toBe("pnpm install --no-frozen-lockfile")
})

it("upgrade refuses uncommitted changes, writes nothing, and says how to go on", async () => {
  const dir = await project()
  lowerPnpm(dir)
  const before = read(dir, "package.json")
  const r = await cli(["upgrade", "--json"], dir, { dirty: " M package.json\n?? notes.txt\n" })
  const doc = JSON.parse(r.stdout)
  expect(doc.error).toMatchObject({
    code: "UncommittedChanges",
    fix: null,
    files: ["package.json", "notes.txt"],
    command: "npx -y create-efforge upgrade --json --allow-dirty",
  })
  expect(r.exitCode).toBe(1)
  expect(read(dir, "package.json")).toBe(before)
  const anyway = await cli(["upgrade", "--json", "--allow-dirty", "--no-install"], dir, {
    dirty: " M package.json\n",
  })
  expect(JSON.parse(anyway.stdout).ok).toBe(true)
  expect(read(dir, "package.json")).not.toBe(before)
})

// finding 5: a project nested in a larger repository
it("upgrade works in a project nested in a larger git repository", async () => {
  const outer = temp()
  const dir = join(outer, "services/app")
  mkdirSync(dir, { recursive: true })
  cpSync(await project(), dir, { recursive: true })
  lowerPnpm(dir)
  const git = (...a: string[]) => spawnSync("git", a, { cwd: outer, encoding: "utf8" })
  git("init", "-q")
  git("add", "-A")
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "init")
  const r = await cli(["upgrade", "--json", "--no-install"], dir, { real: true })
  expect(JSON.parse(r.stdout)).toMatchObject({
    ok: true,
    changed: expect.arrayContaining(["package.json"]),
  })
  expect(read(dir, "package.json")).toContain(`pnpm@${pnpmVersion}`)
})

// ruling 6
it("an older CLI refuses a project made or upgraded by a newer one, and writes nothing", async () => {
  const dir = await project()
  edit(dir, "efforge.jsonc", (t) =>
    t.replace(/"efforgeVersion": "[^"]*"/, '"efforgeVersion": "99.0.0"'),
  )
  for (const args of [
    ["upgrade", "--json"],
    ["upgrade", "--check", "--json"],
  ]) {
    const r = await cli(args, dir)
    const doc = JSON.parse(r.stdout)
    expect(doc.error).toMatchObject({ code: "ProjectNewerThanCli", fix: null, project: "99.0.0" })
    expect(doc.error.command).toContain("create-efforge@latest upgrade")
    expect(r.exitCode).toBe(1)
  }
  expect(read(dir, "efforge.jsonc")).toContain('"efforgeVersion": "99.0.0"')
})

it("upgrade --check --diff --file shows one file against efforge's version", async () => {
  const dir = await project()
  olderTemplate(dir, "apps/web/src/routes/app.tsx", "// older\n")
  const r = await cli(
    ["upgrade", "--check", "--diff", "--file", "apps/web/src/routes/app.tsx"],
    dir,
  )
  expect(r.stdout).toContain(
    "diff --git a/apps/web/src/routes/app.tsx b/apps/web/src/routes/app.tsx",
  )
  expect(r.stdout.match(/^diff --git/gm)).toHaveLength(1)
})

it("efforge.jsonc keeps its comments when upgrade records the version", async () => {
  const dir = await project()
  edit(dir, "efforge.jsonc", (t) =>
    t.replace(
      /"efforgeVersion": "[^"]*",/,
      '// mine: made for the Acme pilot\n  "efforgeVersion": "0.2.0",',
    ),
  )
  await cli(["upgrade", "--json", "--no-install"], dir)
  const text = read(dir, "efforge.jsonc")
  expect(text).toContain("// mine: made for the Acme pilot")
  expect(text).toContain(`"efforgeVersion": "${efforgeVersion}"`)
  expect(existsSync(join(dir, "efforge.jsonc"))).toBe(true)
})
