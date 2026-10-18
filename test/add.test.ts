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
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { afterEach, beforeEach, expect, it, vi } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { loadAddons } from "../src/addon.ts"
import { runWith } from "../src/cli.ts"
import { addAddons } from "../src/commands/add.ts"
import { TemplatesDir } from "../src/commands/create.ts"
import { unifiedDiff } from "../src/diff.ts"
import { generate } from "../src/generate.ts"
import { hash } from "../src/manifest.ts"
import { scriptedPromptIO } from "../src/prompts/navigable.ts"
import { withDefaults } from "../src/stack.ts"
import { writeTree } from "../src/write.ts"

const fixtures = new URL("./fixtures/templates", import.meta.url).pathname
const env = Layer.mergeAll(NodeServices.layer, Layer.succeed(TemplatesDir, fixtures))
type Env = Layer.Success<typeof env>
const runIn = <A, E>(layer: Layer.Layer<Env>, eff: Effect.Effect<A, E, Env>) =>
  Effect.runPromise(eff.pipe(Effect.provide(layer)))
const run = <A, E>(eff: Effect.Effect<A, E, Env>) => runIn(env, eff)
const failIn = async <A, E extends { _tag: string }>(
  layer: Layer.Layer<Env>,
  eff: Effect.Effect<A, E, Env>,
) =>
  (await Effect.runPromise(Effect.flip(eff.pipe(Effect.provide(layer))))) as E &
    Record<string, unknown>
const fail = <A, E extends { _tag: string }>(eff: Effect.Effect<A, E, Env>) => failIn(env, eff)

let tmp: string
let dir: string
beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "efforge-add-"))
  dir = join(tmp, "app")
  // postgres + drizzle fixture project without extras or ai
  await run(
    Effect.gen(function* () {
      const tree = yield* generate(
        withDefaults({ name: "app", auth: "none" }),
        yield* loadAddons(fixtures),
      )
      yield* writeTree(dir, tree)
    }),
  )
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const file = (rel: string) => readFileSync(join(dir, rel), "utf8")
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true })
  writeFileSync(join(dir, rel), text)
}
const snapshot = () => {
  const out: Record<string, string> = {}
  const walk = (d: string, rel = "") => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel === "" ? e.name : `${rel}/${e.name}`
      if (e.isDirectory()) walk(join(d, e.name), r)
      else out[r] = readFileSync(join(d, e.name), "utf8")
    }
  }
  walk(dir)
  return out
}
const opts = { overwrite: false, dryRun: false, install: false }
const manifestOf = () => JSON.parse(file("efforge.jsonc").replace(/^\/\/.*\n/, ""))

it("add email writes the overlays, edits the seam, merges deps, env and manifest", async () => {
  const result = await run(addAddons(dir, ["email"], opts))
  expect(file("apps/web/src/mailer.ts")).toContain("MailerLive")
  expect(file("apps/web/src/outbox.ts")).toContain("outbox")
  expect(file("apps/web/src/layers.ts")).toContain("Layer.mergeAll(DbLive, MailerLive)")
  expect(file("apps/web/src/layers.ts")).toContain('import { MailerLive } from "./mailer.ts"')
  const pkg = JSON.parse(file("apps/web/package.json"))
  expect(pkg.dependencies).toEqual({
    "@effect/sql-pg": "catalog:",
    "drizzle-orm": "catalog:",
    effect: "catalog:",
    "zod-existing": "1.0.0",
  })
  expect(pkg.private).toBe(true)
  expect(file("pnpm-workspace.yaml")).toContain("effect:")
  expect(file(".env.example")).toContain("# Email\nMAIL_FROM=hi@example.com")
  expect(file(".env.example").match(/DATABASE_URL/g)).toHaveLength(1)
  const m = manifestOf()
  expect(m.stack.extras).toEqual(["email"])
  expect(m.command).toBe("npm create efforge app -- --auth=none --extras=email")
  expect(m.files["apps/web/src/mailer.ts"]).toBe(hash(file("apps/web/src/mailer.ts")))
  expect(m.files["apps/web/src/layers.ts"]).toBeUndefined()
  expect(result.transformed).toEqual(["apps/web/src/layers.ts"])
  expect(result.written).toContain("apps/web/src/mailer.ts")
  expect(result.written).toContain("efforge.jsonc")
})

it("running it twice changes nothing", async () => {
  await run(addAddons(dir, ["email"], opts))
  const first = snapshot()
  const again = await run(addAddons(dir, ["extras/email"], opts))
  expect(snapshot()).toEqual(first)
  expect(again.written).toEqual([])
  expect(again.skipped).toEqual(["extras/email"])
})

it("keeps lines the user added to the seam file", async () => {
  put("apps/web/src/layers.ts", `${file("apps/web/src/layers.ts")}export const mine = 1\n`)
  await run(addAddons(dir, ["email"], opts))
  expect(file("apps/web/src/layers.ts")).toContain("export const mine = 1")
  expect(file("apps/web/src/layers.ts")).toContain("MailerLive")
})

it("replaces an overlay that still matches its recorded hash", async () => {
  put("apps/web/src/mailer.ts", "old generated\n")
  const m = manifestOf()
  m.files["apps/web/src/mailer.ts"] = hash("old generated\n")
  put(
    "efforge.jsonc",
    `// Generated by efforge. Used by \`efforge add\`.\n${JSON.stringify(m, null, 2)}\n`,
  )
  await run(addAddons(dir, ["email"], opts))
  expect(file("apps/web/src/mailer.ts")).toContain("MailerLive")
})

it("an edited overlay is an OverlayConflict with a diff; --overwrite replaces it", async () => {
  put("apps/web/src/mailer.ts", "export const mine = true\n")
  const before = snapshot()
  const e = await fail(addAddons(dir, ["email"], opts))
  expect(e._tag).toBe("OverlayConflict")
  expect(e.file).toBe("apps/web/src/mailer.ts")
  expect(e.diff).toContain("-export const mine = true")
  expect(e.diff).toContain("+export const MailerLive = {}")
  expect(snapshot()).toEqual(before)

  await run(addAddons(dir, ["email"], { ...opts, overwrite: true }))
  expect(file("apps/web/src/mailer.ts")).toContain("MailerLive")
})

it("a missing Layer.mergeAll gives TransformAnchorMissing and writes nothing", async () => {
  put("apps/web/src/layers.ts", "export const AppLayer = somethingElse\n")
  const before = snapshot()
  const e = await fail(addAddons(dir, ["email"], opts))
  expect(e._tag).toBe("TransformAnchorMissing")
  expect(e.file).toBe("apps/web/src/layers.ts")
  expect(e.snippet).toContain("MailerLive")
  expect(snapshot()).toEqual(before)
})

it("single-select slots: set when none, refuse a swap", async () => {
  const d1 = await fail(addAddons(dir, ["database/d1"], opts))
  expect(d1).toMatchObject({ _tag: "IncompatibleStack", slot: "database", value: "d1" })
  expect(d1.reason).toContain("swapping")

  await run(addAddons(dir, ["effect-ai-byok"], opts))
  expect(manifestOf().stack.ai).toBe("effect-ai-byok")
  expect(file("apps/web/src/ai.ts")).toContain("ai")
  expect(manifestOf().command).toContain("--ai=effect-ai-byok")
})

it("rejects unknown and ambiguous ids", async () => {
  expect((await fail(addAddons(dir, ["nope"], opts)))._tag).toBe("IncompatibleStack")
  expect((await fail(addAddons(dir, ["none"], opts)))._tag).toBe("IncompatibleStack")
})

it("rejects a directory that is not an efforge project", async () => {
  const e = await fail(addAddons(tmp, ["email"], opts))
  expect(e._tag).toBe("NotAnEfforgeProject")
})

it("dry-run writes nothing but reports the plan", async () => {
  const before = snapshot()
  const r = await run(addAddons(dir, ["email"], { ...opts, dryRun: true }))
  expect(snapshot()).toEqual(before)
  expect(r.written).toContain("apps/web/src/mailer.ts")
  expect(r.transformed).toEqual(["apps/web/src/layers.ts"])
})

it("CLI: add --json --dry-run --cwd", async () => {
  const logs: string[] = []
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")))
  await runWith(["add", "email", "--dry-run", "--json", "--cwd", dir]).pipe(
    Effect.provide(Layer.mergeAll(env, scriptedPromptIO([]).layer)),
    Effect.runPromise,
  )
  vi.restoreAllMocks()
  const out = JSON.parse(logs.join("\n"))
  expect(out.dryRun).toBe(true)
  expect(out.written).toContain("apps/web/src/mailer.ts")
})

it("unifiedDiff shows context and hunks", () => {
  expect(unifiedDiff("f", "a\nb\nc\n", "a\nB\nc\n")).toBe(
    "--- f (on disk)\n+++ f (efforge)\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n",
  )
  expect(unifiedDiff("f", "a\n", "a\n")).toBe("")
})

it("all-or-nothing: a conflict in a later overlay leaves earlier ones unwritten", async () => {
  put("apps/web/src/outbox.ts", "export const mine = true\n")
  const before = snapshot()
  const e = await fail(addAddons(dir, ["email"], opts))
  expect(e._tag).toBe("OverlayConflict")
  expect(e.file).toBe("apps/web/src/outbox.ts")
  expect(snapshot()).toEqual(before)
})

it("a second add is a no-op: all skipped, no install", async () => {
  await run(addAddons(dir, ["email"], opts))
  const first = snapshot()
  const again = await run(addAddons(dir, ["email"], { overwrite: false, dryRun: false }))
  expect(again).toEqual({ written: [], transformed: [], skipped: ["extras/email"] })
  expect(snapshot()).toEqual(first)
})

it("a user-edited non-addon file is untouched", async () => {
  put("apps/web/src/other.ts", "export const x = 1\n")
  put("README.md", "mine\n")
  await run(addAddons(dir, ["email"], opts))
  expect(file("apps/web/src/other.ts")).toBe("export const x = 1\n")
  expect(file("README.md")).toBe("mine\n")
})

it("--cwd may be relative", async () => {
  const prev = process.cwd()
  process.chdir(tmp)
  try {
    await run(addAddons("app", ["email"], opts))
  } finally {
    process.chdir(prev)
  }
  expect(file("apps/web/src/mailer.ts")).toContain("MailerLive")
})

it("running from a subdirectory is a clear NotAnEfforgeProject", async () => {
  const e = await fail(addAddons(join(dir, "apps/web"), ["email"], opts))
  expect(e._tag).toBe("NotAnEfforgeProject")
  expect(String(e.reason)).toContain("efforge.jsonc")
})

it("rejects add-on targets that escape the project", async () => {
  for (const target of ["../outside.ts", "/tmp/efforge-abs-outside.ts"]) {
    const tpl = join(tmp, "tpl")
    rmSync(tpl, { recursive: true, force: true })
    cpSync(fixtures, tpl, { recursive: true })
    const p = join(tpl, "extras/email/addon.json")
    const j = JSON.parse(readFileSync(p, "utf8"))
    j.files[0].target = target
    writeFileSync(p, JSON.stringify(j))
    const layer = Layer.mergeAll(NodeServices.layer, Layer.succeed(TemplatesDir, tpl))
    const before = snapshot()
    const e = await failIn(layer, addAddons(dir, ["email"], opts))
    expect(e._tag).toBe("GenerateError")
    expect(snapshot()).toEqual(before)
    expect(existsSync(join(tmp, "outside.ts"))).toBe(false)
    expect(existsSync("/tmp/efforge-abs-outside.ts")).toBe(false)
  }
})
