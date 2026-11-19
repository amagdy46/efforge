import { stripVTControlCharacters } from "node:util"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { afterEach, beforeEach, expect, it, vi } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { completionScript, runWith } from "../src/cli.ts"
import { TemplatesDir } from "../src/commands/create.ts"
import {
  GRAPH_REGION,
  graphNodes,
  layerGraph,
  mermaid,
  parseLayers,
  textGraph,
  writeGraph,
} from "../src/graph.ts"
import { presetIds } from "../src/presets.ts"
import { type Answer, scriptedPromptIO } from "../src/prompts/navigable.ts"
import { GraphOutput, InfoOutput } from "../src/schemas.ts"
import { Schema } from "effect"
import { recordingSpawner } from "./recordingSpawner.ts"

// `info`, `graph` and the `add` picker, run against the real templates.

const templates = new URL("../templates", import.meta.url).pathname
let cwd: string
let tmp: string
let logs: string[]
let errors: string[]

beforeEach(() => {
  cwd = process.cwd()
  tmp = mkdtempSync(join(tmpdir(), "efforge-commands-"))
  process.chdir(tmp)
  logs = []
  errors = []
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")))
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.join(" ")))
  process.exitCode = undefined
})
afterEach(() => {
  vi.restoreAllMocks()
  process.chdir(cwd)
  rmSync(tmp, { recursive: true, force: true })
  process.exitCode = undefined
})

const cli = async (args: string[], answers: ReadonlyArray<Answer> = []) => {
  const s = scriptedPromptIO(answers)
  const calls: string[] = []
  logs = []
  errors = []
  await runWith(args).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        s.layer,
        Layer.succeed(TemplatesDir, templates),
        recordingSpawner(calls),
      ),
    ),
    Effect.runPromise,
  )
  const exitCode = process.exitCode ?? 0
  process.exitCode = undefined
  return { s, calls, exitCode, out: logs.join("\n"), err: errors.join("\n") }
}
const json = (out: string) => JSON.parse(out) as Record<string, unknown>
const create = (name: string, ...flags: string[]) =>
  cli(["create", name, "--json", "--no-install", "--no-git", ...flags])

it("info describes an add-on from its manifest, outside and inside a project", async () => {
  const outside = await cli(["info", "email", "--json"])
  expect(outside.exitCode).toBe(0)
  const doc = Schema.decodeUnknownSync(InfoOutput)(json(outside.out))
  expect(doc).toMatchObject({
    id: "extras/email",
    layer: "MailerLive",
    service: { name: "Mailer" },
    docs: { page: "docs/addons/extras-email.md" },
    requires: [],
  })
  expect(doc.edits.map((e) => e.file)).toContain("apps/web/src/server/layers.ts")
  expect("project" in doc).toBe(false)

  await create("app", "--database=none")
  const auth = json((await cli(["info", "auth/better-auth", "--json", "--cwd", "app"])).out)
  expect(auth.project).toMatchObject({ installed: false, add: null })
  // the ways out are complete commands that add a database and an ORM with it
  expect((auth.project as { alternatives: string[] }).alternatives).toContain(
    "npx -y create-efforge add database/postgres orm/drizzle auth/better-auth --cwd app",
  )
  const ai = json((await cli(["info", "ai", "--json", "--cwd", "app"])).out)
  expect(ai.project).toMatchObject({ add: "npx -y create-efforge add ai/effect-ai-byok --cwd app" })
  // inside a project: only what this stack gets, without conditions
  expect((ai.files as Array<{ when?: unknown }>).every((f) => f.when === undefined)).toBe(true)
})

it("info resolves ids the way add does, typo rule included", async () => {
  const typo = await cli(["info", "emial", "--json"])
  expect(typo.exitCode).toBe(1)
  expect(json(typo.out).error).toMatchObject({
    code: "UnknownAddon",
    fix: "npx -y create-efforge info extras/email --json",
  })
  const none = await cli(["info", "--json"])
  expect(json(none.out).error).toMatchObject({
    code: "NoAddonIds",
    fix: "npx -y create-efforge list --json",
  })
  const text = await cli(["info", "storage"])
  // CI=1 turns colours on
  const shown = stripVTControlCharacters(text.out)
  expect(shown).toContain("Storage  extras/storage")
  expect(shown).toMatch(/env +STORAGE_SIGNING_SECRET/)
})

it("graph reads AppLayer from layers.ts and joins the add-ons' facts", async () => {
  await create("app", "--extras=email,realtime")
  const r = await cli(["graph", "--json", "--cwd", "app"])
  expect(r.exitCode).toBe(0)
  const doc = Schema.decodeUnknownSync(GraphOutput)(json(r.out))
  expect(doc.layers.map((l) => [l.name, l.addon])).toEqual([
    ["Logger.layer", "base"],
    ["DatabaseLayer", "orm/drizzle"],
    ["AuthLive", "auth/better-auth-orgs"],
    ["RealtimeLive", "extras/realtime"],
    ["MailerLive", "extras/email"],
  ])
  const database = doc.layers[1]
  expect(database?.provides).toEqual(["Database", "Notes"])
  expect(database?.needs).toEqual(["WorkerEnvLive", "database binding"])
  // a layer without a card: its service and needs from the manifest
  expect(doc.layers[4]).toMatchObject({
    provides: ["Mailer"],
    needs: ["EMAIL binding", "MAIL_FROM", "MAIL_TRANSPORT"],
  })
  expect(doc.edges).toContainEqual({ from: "l0", to: "app", kind: "merges" })
  expect(doc.mermaid.startsWith("flowchart LR\n")).toBe(true)

  const text = await cli(["graph", "--format=text", "--cwd", "app"])
  expect(text.out.split("\n")[0]).toBe("AppLayer  (apps/web/src/server/layers.ts)")
  expect(text.out).toContain("└─ MailerLive")
})

it("graph shows your own layers, with provides and needs unknown", () => {
  const layers = parseLayers(
    'import { Layer, Logger } from "effect"\nexport const AppLayer = Layer.mergeAll(\n  Logger.layer([Logger.consolePretty()]),\n  MyCacheLive.pipe(Layer.provide(RedisLive)),\n)\n',
  )
  expect(layers).toEqual([
    { name: "Logger.layer", expression: "Logger.layer([Logger.consolePretty()])", provided: [] },
    {
      name: "MyCacheLive",
      expression: "MyCacheLive.pipe(Layer.provide(RedisLive))",
      provided: ["RedisLive"],
    },
  ])
  const g = layerGraph({
    layers: layers ?? [],
    stack: {
      name: "app",
      runtime: "cloudflare",
      database: "none",
      orm: "none",
      auth: "none",
      infra: "none",
      ai: "none",
      extras: [],
    },
    addons: new Map(),
    cards: new Map(),
  })
  expect(g.layers[1]).toMatchObject({
    name: "MyCacheLive",
    addon: null,
    provides: null,
    needs: null,
  })
  expect(mermaid(g)).toContain('l1["<b>MyCacheLive</b><br/>provides: unknown"]:::t2')
  expect(textGraph(g)).toContain("needs     unknown")
  expect(graphNodes(g).edges).toEqual([
    { from: "l0", to: "app", kind: "merges" },
    { from: "l1", to: "app", kind: "merges" },
  ])
  expect(parseLayers("export const AppLayer = Layer.merge(A, B)\n")).toBeUndefined()
})

it("graph --write fills the README's graph region; add keeps it current; damaged markers are left alone", async () => {
  await create("app", "--database=d1")
  const readme = () => readFileSync(join(tmp, "app", "README.md"), "utf8")
  const before = readme()
  expect((await cli(["graph", "--write", "--cwd", "app"])).exitCode).toBe(0)
  const after = readme()
  expect(after).toContain(`<!-- efforge:readme:${GRAPH_REGION} -->`)
  expect(after).toContain("```mermaid\nflowchart LR")
  // the region goes after the capabilities region; nothing else moves
  expect(after.indexOf("efforge:readme:graph")).toBeGreaterThan(
    after.indexOf("/efforge:readme:capabilities"),
  )
  expect(
    after.replace(
      /\n## Layer graph\n\n<!-- efforge:readme:graph -->[\s\S]*<!-- \/efforge:readme:graph -->\n/,
      "",
    ),
  ).toBe(before)
  // a second write changes nothing
  await cli(["graph", "--write", "--cwd", "app"])
  expect(readme()).toBe(after)

  // add redraws it
  expect((await cli(["add", "storage", "--cwd", "app", "--no-install", "--json"])).exitCode).toBe(0)
  expect(readme()).toContain("StorageLive")

  // a README whose markers are broken is never touched
  const broken = readme().replace("<!-- /efforge:readme:about -->\n", "")
  writeFileSync(join(tmp, "app", "README.md"), broken)
  const r = await cli(["graph", "--write", "--json", "--cwd", "app"])
  expect(r.exitCode).toBe(1)
  expect(json(r.out).error).toMatchObject({ code: "ReadmeUnwritable", fix: null })
  expect(readme()).toBe(broken)
  expect(writeGraph("# no markers\n", { file: "x", layers: [] })).toEqual({ kind: "no-markers" })
})

it("graph outside a project is NotAnEfforgeProject; a layers.ts without mergeAll is LayersUnreadable", async () => {
  const r = await cli(["graph", "--json"])
  expect(json(r.out).error).toMatchObject({ code: "NotAnEfforgeProject" })
  await create("app", "--database=none")
  writeFileSync(join(tmp, "app/apps/web/src/server/layers.ts"), "export const AppLayer = 1\n")
  const bad = await cli(["graph", "--json", "--cwd", "app"])
  expect(json(bad.out).error).toMatchObject({ code: "LayersUnreadable", fix: null })
})

it("add with no ids: a picker by slot, disabled where the slot is filled, re-asked when the rules refuse", async () => {
  await create("app", "--database=d1", "--auth=none")
  const r = await cli(
    ["add", "--cwd", "app", "--dry-run"],
    // auth alone is fine on this stack: it has a database
    [["auth/better-auth"]],
  )
  const [shown] = r.s.shown
  expect(shown?.id).toBe("addons")
  expect(shown?.options).toContain("auth/better-auth")
  expect(shown?.options).not.toContain("database/d1")
  // a filled slot shows its other options, disabled
  expect(shown?.disabled).toEqual(["database/postgres", "orm/effect-sql"])
  expect(r.s.output).toContain(
    "info: The same without the picker:\nnpx -y create-efforge add auth/better-auth --cwd app --dry-run",
  )

  const nothing = await cli(["add", "--cwd", "app"], [[]])
  expect(nothing.exitCode).toBe(0)
  expect(nothing.s.output).toContain("outro: Nothing picked, nothing added.")
  expect(nothing.calls).toEqual([])

  await create("bare", "--database=none")
  const again = await cli(
    ["add", "--cwd", "bare", "--dry-run"],
    [["auth/better-auth"], ["database/d1", "orm/drizzle", "auth/better-auth"]],
  )
  expect(again.s.shown.map((x) => x.id)).toEqual(["addons", "addons"])
  expect(again.s.output.find((o) => o.startsWith("warn: Can't add auth/better-auth"))).toContain(
    "Pick one of database/postgres, database/d1 and one of orm/drizzle, orm/effect-sql with it.",
  )
  expect(again.exitCode).toBe(0)
})

it("completions cover the new commands and the preset values", () => {
  const zsh = completionScript("zsh")
  for (const word of ["info", "graph", "--preset", ...presetIds, "--format", "mermaid", "--write"])
    expect(zsh).toContain(word)
  const bash = completionScript("bash")
  expect(bash).toContain("graph")
  expect(bash).toContain("minimal")
})

it("an env var has the same fields in create, add and info: secret is a secret, set is a local value written", async () => {
  type Env = { name: string; description: string; set: boolean; secret: boolean }
  const shared = ["name", "description", "set", "secret"] as const
  const pick = (v: Env) => Object.fromEntries(shared.map((k) => [k, v[k]]))
  const fromInfo = new Map<string, Env>()
  const seen: Env[] = []
  // create: two stacks between them have every env var
  for (const flags of [
    ["--extras=storage,email", "--ai=effect-ai-byok", "--infra=alchemy"],
    ["--database=d1", "--orm=effect-sql", "--auth=better-auth", "--ai=effect-ai-byok"],
  ]) {
    const r = await cli([
      "create",
      "app",
      "--json",
      "--dry-run",
      "--no-install",
      "--no-git",
      ...flags,
    ])
    const doc = json(r.out) as { stack: Record<string, unknown>; env: Env[] }
    for (const v of doc.env) for (const k of shared) expect(v, v.name).toHaveProperty(k)
    seen.push(...doc.env)
  }
  // add, on a project without any
  await create("bare", "--database=none")
  const added = await cli([
    "add",
    "database/postgres",
    "orm/drizzle",
    "auth/better-auth",
    "ai",
    "storage",
    "email",
    "--cwd",
    "bare",
    "--dry-run",
    "--json",
    "--no-install",
  ])
  seen.push(...(json(added.out) as { env: Env[] }).env)
  for (const id of [
    "database/postgres",
    "auth/better-auth",
    "auth/better-auth-orgs",
    "ai",
    "storage",
    "email",
    "infra/alchemy",
  ]) {
    const r = await cli(["info", id, "--json"])
    for (const v of (json(r.out) as { env: Env[] }).env) {
      for (const k of shared) expect(v, `info ${id} ${v.name}`).toHaveProperty(k)
      // the AI add-on's settings differ by stack, each name once
      if (!fromInfo.has(v.name)) fromInfo.set(v.name, v)
    }
  }
  for (const v of seen) {
    const i = fromInfo.get(v.name)
    expect(i, v.name).toBeDefined()
    expect(pick(v), v.name).toEqual(pick(i as Env))
  }
  // what a secret is, by name: a key, a password, a signing secret, a connection string
  for (const v of fromInfo.values())
    expect(v.secret, v.name).toBe(/SECRET|_KEY$|TOKEN|PASSWORD|DATABASE_URL/.test(v.name))
  expect(fromInfo.get("BETTER_AUTH_SECRET")).toMatchObject({ secret: true, set: true })
  expect(fromInfo.get("LLM_API_KEY")).toMatchObject({ secret: true, set: false })
  expect(fromInfo.get("MAIL_FROM")).toMatchObject({ secret: false, set: true })
})

it("review nits: edits carry when, flags name their commands, case gets a fix, --verbose says it did nothing", async () => {
  // outside a project an edit only some stacks get says which
  const email = json((await cli(["info", "email", "--json"])).out) as {
    edits: { file: string; when?: Record<string, string[]> }[]
  }
  expect(email.edits.find((e) => e.file === "wrangler.jsonc")?.when).toEqual({ infra: ["none"] })
  // a flag of another command names the commands that take it
  const write = await cli(["x1", "--write", "--json"])
  expect((json(write.out).error as { message: string }).message).toContain(
    "--write belongs to graph,",
  )
  const cwdFlag = await cli(["x1", "--cwd", "app", "--json"])
  expect((json(cwdFlag.out).error as { message: string }).message).toContain(
    "--cwd belongs to add, list, info, graph, upgrade and doctor,",
  )
  // a preset or a value in other case is that one
  const preset = await cli(["create", "app", "--json", "--dry-run", "--preset=SaaS"])
  expect(json(preset.out).error).toMatchObject({
    code: "UnknownValue",
    fix: "npx -y create-efforge create app --json --dry-run --preset=saas",
  })
  const d1 = await cli(["create", "app", "--json", "--dry-run", "--database=D1"])
  expect((json(d1.out).error as { fix: string }).fix).toContain("--database=d1")
  // --verbose without --dry-run
  const verbose = await cli(["create", "app", "--json", "--verbose", "--no-install", "--no-git"])
  expect(json(verbose.out).warnings).toContain(
    "--verbose only changes what --dry-run prints, so it does nothing here.",
  )
  // a layer you added has no stray fields
  const graph = json((await cli(["graph", "--json", "--cwd", "app"])).out) as {
    layers: Record<string, unknown>[]
  }
  for (const l of graph.layers)
    expect(Object.keys(l).toSorted()).toEqual([
      "addon",
      "color",
      "expression",
      "name",
      "needs",
      "provides",
    ])
})

it("doctor's env check gives each variable the same secret and set as info", async () => {
  await create("dr", "--database=d1", "--auth=better-auth", "--ai=effect-ai-byok")
  const r = await cli(["doctor", "--json", "--cwd", "dr"])
  const env = (
    json(r.out) as {
      checks: Array<{ id: string; details?: { vars?: Array<Record<string, unknown>> } }>
    }
  ).checks.find((c) => c.id === "env")
  const vars = env?.details?.vars ?? []
  expect(vars.length).toBeGreaterThan(3)
  const info = new Map<string, Record<string, unknown>>()
  for (const id of ["auth/better-auth", "ai"])
    for (const v of (
      json((await cli(["info", id, "--json", "--cwd", "dr"])).out) as {
        env: Array<Record<string, unknown>>
      }
    ).env)
      info.set(String(v.name), v)
  for (const v of vars) {
    const i = info.get(String(v.name))
    if (i === undefined) continue
    expect({ secret: v.secret, set: v.set }, String(v.name)).toEqual({
      secret: i.secret,
      set: i.set,
    })
  }
  expect(vars.find((v) => v.name === "BETTER_AUTH_SECRET")).toMatchObject({
    secret: true,
    set: true,
  })
  expect(vars.find((v) => v.name === "LLM_API_KEY")).toMatchObject({ secret: true, set: false })
}, 60_000)
