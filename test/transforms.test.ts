import { readFileSync } from "node:fs"
import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { parse } from "jsonc-parser"
import {
  runTransform,
  TransformAnchorMissing,
  type TransformCall,
  UnknownTransform,
} from "../src/transforms/index.ts"
import type { Tree } from "../src/tree.ts"

const run = (tree: Tree, t: TransformCall) => Effect.runPromise(runTransform(tree, t))
const fail = (tree: Tree, t: TransformCall) => Effect.runPromise(Effect.flip(runTransform(tree, t)))
const once = async (files: Record<string, string>, t: TransformCall) => {
  const tree = new Map(Object.entries(files))
  const a = await run(tree, t)
  const b = await run(a, t)
  expect(Object.fromEntries(b)).toEqual(Object.fromEntries(a))
  return a
}

// ---- addImport
const imp = (file = "a.ts"): TransformCall => ({
  name: "addImport",
  args: { file, import: "Foo", from: "foo" },
})

it("addImport adds a new import, merges into an existing one, and is idempotent", async () => {
  const t1 = await once({ "a.ts": 'import { x } from "y"\nconst a = 1\n' }, imp())
  expect(t1.get("a.ts")).toBe('import { Foo } from "foo"\nimport { x } from "y"\nconst a = 1\n')
  const t2 = await once({ "a.ts": 'import { Bar } from "foo"\n' }, imp())
  expect(t2.get("a.ts")).toBe('import { Bar, Foo } from "foo"\n')
  const t3 = await once(
    { "a.ts": "const a = 1\n" },
    { name: "addImport", args: { file: "a.ts", import: "* as NS", from: "ns" } },
  )
  expect(t3.get("a.ts")).toBe('import * as NS from "ns"\nconst a = 1\n')
})

it("addImport fails on a missing file and on an unknown transform", async () => {
  const e = await fail(new Map(), imp("nope.ts"))
  expect(e).toBeInstanceOf(TransformAnchorMissing)
  expect((e as TransformAnchorMissing).anchor).toBe("file")
  expect(await fail(new Map(), { name: "nope", args: {} })).toBeInstanceOf(UnknownTransform)
})

// ---- addLayer
const layers = (args = "/* efforge:layers */") =>
  `import { Layer } from "effect"\n\nexport const AppLayer = Layer.mergeAll(${args})\n`
const addLayer = (layer = "DbLive"): TransformCall => ({
  name: "addLayer",
  args: { file: "apps/web/src/server/layers.ts", import: layer, from: "@app/db", layer },
})
const LF = "apps/web/src/server/layers.ts"

it("addImport keeps a deterministic import order: packages, then relative paths", async () => {
  const src = 'import { a } from "effect"\nimport { b } from "./b"\n'
  const t = await once(
    { "a.ts": src },
    { name: "addImport", args: { file: "a.ts", import: "C", from: "@scope/c" } },
  )
  expect(t.get("a.ts")).toBe(
    'import { C } from "@scope/c"\nimport { a } from "effect"\nimport { b } from "./b"\n',
  )
  const u = await once(
    { "a.ts": src },
    { name: "addImport", args: { file: "a.ts", import: "D", from: "./cloudflare" } },
  )
  expect(u.get("a.ts")).toBe(
    'import { a } from "effect"\nimport { b } from "./b"\nimport { D } from "./cloudflare"\n',
  )
})

it("addLayer fills the empty mergeAll and is idempotent", async () => {
  const tree = await once({ [LF]: layers() }, addLayer())
  expect(tree.get(LF)).toBe(
    `import { DbLive } from "@app/db"\nimport { Layer } from "effect"\n\nexport const AppLayer = Layer.mergeAll(/* efforge:layers */ DbLive)\n`,
  )
  const two = await run(tree, addLayer("AuthLive"))
  expect(two.get(LF)).toContain("Layer.mergeAll(/* efforge:layers */ DbLive, AuthLive)")
})

it("addLayer appends after a user layer in reformatted multi-line args with trailing comma", async () => {
  const src = `import { Layer } from "effect"\nimport { Mine } from "./mine"\n\nexport const AppLayer = Layer.mergeAll(\n  /* efforge:layers */\n  Mine,\n  Other.layer({ a: 1 }),\n)\n`
  const tree = await once({ [LF]: src }, addLayer())
  expect(tree.get(LF)).toContain("  Other.layer({ a: 1 }),\n  DbLive,\n)")
  expect(tree.get(LF)).toContain('import { DbLive } from "@app/db"')
})

it("addLayer handles multi-line args without trailing comma and an empty line-comment body", async () => {
  const a = await once({ [LF]: layers("\n  A,\n  B\n") }, addLayer())
  expect(a.get(LF)).toContain("  A,\n  B,\n  DbLive\n)")
  const b = await once({ [LF]: layers("\n  // efforge:layers\n") }, addLayer())
  expect(b.get(LF)).toContain("  // efforge:layers\n  DbLive,\n)")
})

it("addLayer detects an existing layer even when the user reformatted it", async () => {
  const src = layers("\n  Db\n    .layer(),\n")
  const tree = await run(new Map([[LF, src]]), {
    name: "addLayer",
    args: { ...addLayer().args, layer: "Db.layer()", import: "Db" },
  })
  expect(tree.get(LF)).toContain('import { Db } from "@app/db"')
  expect(tree.get(LF)?.match(/Db\s*\.layer\(\)/g)).toHaveLength(1)
})

it("addLayer reports the anchor with a snippet", async () => {
  const e = (await fail(
    new Map([[LF, "export const Other = 1\n"]]),
    addLayer(),
  )) as TransformAnchorMissing
  expect(e).toBeInstanceOf(TransformAnchorMissing)
  expect(e.file).toBe(LF)
  expect(e.snippet).toContain("Layer.mergeAll(")
  expect(e.snippet).toContain("DbLive")
  expect(((await fail(new Map(), addLayer())) as TransformAnchorMissing).anchor).toBe("file")
})

// ---- addAuthPlugin
const AF = "apps/web/src/server/auth.ts"
const auth = (plugins = "[/* efforge:auth-plugins */]") =>
  `import { betterAuth } from "better-auth"\n\nexport const auth = betterAuth({\n  database: db,\n  plugins: ${plugins},\n})\n`
const plugin = (call = "organization()"): TransformCall => ({
  name: "addAuthPlugin",
  args: { import: "organization", from: "better-auth/plugins", call },
})

it("addAuthPlugin appends a plugin and is idempotent by callee name", async () => {
  const tree = await once({ [AF]: auth() }, plugin())
  expect(tree.get(AF)).toContain("plugins: [/* efforge:auth-plugins */ organization()]")
  expect(tree.get(AF)).toContain('import { organization } from "better-auth/plugins"')
  const other = await run(tree, plugin("admin()"))
  expect(other.get(AF)).toContain("[/* efforge:auth-plugins */ organization(), admin()]")
  // same callee, different options: still present
  expect(await run(other, plugin("organization({ x: 1 })"))).toBe(other)
})

it("addAuthPlugin reports missing anchors", async () => {
  const e = (await fail(
    new Map([
      [AF, 'import { betterAuth } from "better-auth"\nexport const auth = betterAuth({})\n'],
    ]),
    plugin(),
  )) as TransformAnchorMissing
  expect(e.snippet).toContain("plugins: [organization()]")
  expect(((await fail(new Map(), plugin())) as TransformAnchorMissing).anchor).toBe("file")
})

const merge = (value = "async () => {}"): TransformCall => ({
  name: "addAuthPlugin",
  args: { mergeInto: "organization", property: "sendInvitationEmail", value },
})

it("addAuthPlugin mergeInto adds a property to an existing plugin call, idempotently", async () => {
  const a = await once({ [AF]: auth('[organization({ creatorRole: "owner" })]') }, merge())
  expect(a.get(AF)).toContain(
    'organization({ creatorRole: "owner", sendInvitationEmail: async () => {} })',
  )
  const b = await once({ [AF]: auth("[organization()]") }, merge())
  expect(b.get(AF)).toContain("organization({ sendInvitationEmail: async () => {} })")
  const c = await once(
    { [AF]: auth('[\n    organization({\n      creatorRole: "owner",\n    }),\n  ]') },
    merge(),
  )
  expect(c.get(AF)).toContain(
    'creatorRole: "owner",\n      sendInvitationEmail: async () => {},\n    })',
  )
})

it("addAuthPlugin mergeInto fails when the plugin is absent", async () => {
  const e = (await fail(new Map([[AF, auth()]]), merge())) as TransformAnchorMissing
  expect(e.anchor).toContain("organization(")
  expect(e.snippet).toContain("sendInvitationEmail")
})

// ---- addAlchemyResource
const AL = "infra/alchemy.run.ts"
const alchemy = (bindings = "{}", pre = "") =>
  `import * as Alchemy from "alchemy"\n\nexport default Alchemy.Stack("app", {}, Effect.gen(function* () {\n  ${pre}// efforge:resources\n  const web = yield* Cloudflare.Worker("web", {\n    bindings: ${bindings},\n  })\n}))\n`
const res: TransformCall = {
  name: "addAlchemyResource",
  args: { name: "bucket", code: 'const bucket = yield* Cloudflare.R2Bucket("bucket")' },
}

it("addAlchemyResource inserts code before the marker and binds it, idempotently", async () => {
  const tree = await once({ [AL]: alchemy() }, res)
  const text = tree.get(AL) as string
  expect(text).toContain(
    '  const bucket = yield* Cloudflare.R2Bucket("bucket")\n  // efforge:resources',
  )
  expect(text).toContain("bindings: { bucket }")
  const two = await run(tree, {
    name: "addAlchemyResource",
    args: { name: "db", code: 'const db = yield* Cloudflare.D1Database("db")' },
  })
  expect(two.get(AL)).toContain("bindings: { bucket, db }")
})

it("addAlchemyResource binds under an explicit key into Alchemy's `env`, idempotently", async () => {
  const web = alchemy("{}").replace("bindings:", "env:")
  const hd: TransformCall = {
    name: "addAlchemyResource",
    args: { name: "hyperdrive", binding: "HYPERDRIVE", code: "const hyperdrive = 1" },
  }
  const tree = await once({ [AL]: web }, hd)
  expect(tree.get(AL)).toContain("env: { HYPERDRIVE: hyperdrive }")
  const two = await run(tree, hd)
  expect(two.get(AL)).toBe(tree.get(AL))
  const three = await run(tree, {
    name: "addAlchemyResource",
    args: { name: "bucket", binding: "STORAGE", code: "const bucket = 2" },
  })
  expect(three.get(AL)).toContain("env: { HYPERDRIVE: hyperdrive, STORAGE: bucket }")
})

it("addAlchemyResource respects existing declarations and multi-line bindings", async () => {
  const tree = await once({ [AL]: alchemy("{\n      a,\n    }") }, res)
  expect(tree.get(AL)).toContain("      a,\n      bucket,\n    }")
})

it("addAlchemyResource reports missing marker and bindings", async () => {
  const noMarker = alchemy().replace("// efforge:resources", "")
  const e1 = (await fail(new Map([[AL, noMarker]]), res)) as TransformAnchorMissing
  expect(e1.anchor).toBe("// efforge:resources")
  expect(e1.snippet).toContain("R2Bucket")
  const e2 = (await fail(
    new Map([[AL, alchemy().replace(/bindings:[^\n]*\n/, "")]]),
    res,
  )) as TransformAnchorMissing
  expect(e2.anchor).toContain("env")
  expect(((await fail(new Map(), res)) as TransformAnchorMissing).anchor).toBe("file")
})

// ---- addWranglerBinding
const WF = "wrangler.jsonc"
const wr: TransformCall = {
  name: "addWranglerBinding",
  args: { key: "d1_databases", value: '{"binding":"DB","database_name":"app"}' },
}

it("addWranglerBinding creates the array, appends, and dedupes by binding", async () => {
  const tree = await once({ [WF]: '{\n  "name": "app"\n}\n' }, wr)
  expect(JSON.parse(tree.get(WF) as string).d1_databases).toEqual([
    { binding: "DB", database_name: "app" },
  ])
  const two = await run(tree, {
    name: "addWranglerBinding",
    args: { key: "d1_databases", value: '{"binding":"OTHER"}' },
  })
  expect(JSON.parse(two.get(WF) as string).d1_databases).toHaveLength(2)
})

it("addWranglerBinding dedupes by name and preserves comments", async () => {
  const src = `{
  // worker name
  "name": "app", /* inline */
  "queues": {
    "producers": []
  },
  // my buckets
  "r2_buckets": [
    { "binding": "MINE", "bucket_name": "m" }, // keep me
  ],
}
`
  const r2: TransformCall = {
    name: "addWranglerBinding",
    args: { key: "r2_buckets", value: '{"binding":"FILES","bucket_name":"f"}' },
  }
  const tree = await once({ [WF]: src }, r2)
  const text = tree.get(WF) as string
  for (const c of ["// worker name", "/* inline */", "// my buckets", "// keep me"])
    expect(text).toContain(c)
  expect(text).toContain('"binding": "FILES"')
  expect(text).toContain('"MINE"')
  const named: TransformCall = {
    name: "addWranglerBinding",
    args: { key: "services", value: '{"name":"svc"}' },
  }
  const withSvc = await once({ [WF]: src }, named)
  expect(parse(withSvc.get(WF) as string).services).toEqual([{ name: "svc" }])
})

it("addWranglerBinding reports a missing file and a non-array key", async () => {
  expect(((await fail(new Map(), wr)) as TransformAnchorMissing).anchor).toBe("file")
  const e = (await fail(new Map([[WF, '{"d1_databases": {}}']]), wr)) as TransformAnchorMissing
  expect(e.anchor).toContain("d1_databases")
  expect(e.snippet).toContain("DB")
})

it("addWranglerBinding supports a dotted key path and creates missing parents", async () => {
  const doBinding: TransformCall = {
    name: "addWranglerBinding",
    args: { key: "durable_objects.bindings", value: '{"name":"ROOM","class_name":"Room"}' },
  }
  const tree = await once({ [WF]: '{\n  "name": "app"\n}\n' }, doBinding)
  expect(parse(tree.get(WF) as string).durable_objects).toEqual({
    bindings: [{ name: "ROOM", class_name: "Room" }],
  })
  const two = await once(
    { [WF]: '{ "durable_objects": { "bindings": [{ "name": "MINE", "class_name": "M" }] } }' },
    doBinding,
  )
  expect(parse(two.get(WF) as string).durable_objects.bindings).toHaveLength(2)
  const e = (await fail(
    new Map([[WF, '{"durable_objects": []}']]),
    doBinding,
  )) as TransformAnchorMissing
  expect(e.anchor).toContain("durable_objects.bindings")
})

it("addWranglerBinding dedupes entries without binding or name by content", async () => {
  const migration: TransformCall = {
    name: "addWranglerBinding",
    args: { key: "migrations", value: '{"tag":"realtime-v1","new_sqlite_classes":["Room"]}' },
  }
  const tree = await once({ [WF]: "{}" }, migration)
  const two = await once(Object.fromEntries(tree), {
    name: "addWranglerBinding",
    args: { key: "migrations", value: '{"tag":"browser-v1","new_sqlite_classes":["B"]}' },
  })
  expect(parse(two.get(WF) as string).migrations).toHaveLength(2)
})

// ---- addExport
const exp = (spec: string, from = "./room", file = "w.ts"): TransformCall => ({
  name: "addExport",
  args: { file, export: spec, from },
})

it("addExport appends a re-export, merges names into an existing one, and is idempotent", async () => {
  const a = await once({ "w.ts": 'import x from "x"\nexport default x\n' }, exp("Room"))
  expect(a.get("w.ts")).toBe('import x from "x"\nexport default x\nexport { Room } from "./room"\n')
  const b = await once({ "w.ts": 'export { A } from "./room"\n' }, exp("B"))
  expect(b.get("w.ts")).toBe('export { A, B } from "./room"\n')
  const c = await once({ "w.ts": "export const a = 1" }, exp("*"))
  expect(c.get("w.ts")).toBe('export const a = 1\nexport * from "./room"\n')
  expect((await once({ "w.ts": 'export { A, B } from "./room"\n' }, exp("A, B"))).get("w.ts")).toBe(
    'export { A, B } from "./room"\n',
  )
})

it("addExport treats type-only re-exports as distinct from value re-exports", async () => {
  const star = await once({ "w.ts": 'export type * from "./room"\n' }, exp("*"))
  expect(star.get("w.ts")).toBe('export type * from "./room"\nexport * from "./room"\n')
  const named = await once({ "w.ts": 'export type { Room } from "./room"\n' }, exp("Room"))
  expect(named.get("w.ts")).toBe(
    'export type { Room } from "./room"\nexport { Room } from "./room"\n',
  )
  const inline = await once({ "w.ts": 'export { type Room } from "./room"\n' }, exp("Room"))
  expect(inline.get("w.ts")).toContain("Room")
  expect((inline.get("w.ts") as string).match(/Room/g)?.length).toBeGreaterThan(1)
  const done = await once({ "w.ts": 'export * from "./room"\n' }, exp("*"))
  expect(done.get("w.ts")).toBe('export * from "./room"\n')
})

it("addExport fails on a missing file", async () => {
  const e = await fail(new Map(), exp("Room", "./room", "nope.ts"))
  expect(e).toBeInstanceOf(TransformAnchorMissing)
})

// ---- addArrayItem
const arr = (item = "storageRoute", extra: Record<string, string> = {}): TransformCall => ({
  name: "addArrayItem",
  args: { file: "r.ts", name: "workerRoutes", item, ...extra },
})
const routesSrc = (body = "/* efforge:routes */") =>
  `export const workerRoutes: ReadonlyArray<string> = [${body}]\n`

it("addArrayItem appends to the named array, adds the import, and is idempotent", async () => {
  const a = await once(
    { "r.ts": routesSrc() },
    arr("storageRoute", { import: "storageRoute", from: "./storage" }),
  )
  expect(a.get("r.ts")).toBe(
    `import { storageRoute } from "./storage"\n${routesSrc("/* efforge:routes */ storageRoute")}`,
  )
  const b = await run(a, arr("roomRoute"))
  expect(b.get("r.ts")).toContain("/* efforge:routes */ storageRoute, roomRoute]")
})

it("addArrayItem keeps user formatting in multi-line arrays", async () => {
  const src = routesSrc("\n  mine,\n  other(),\n")
  const t = await once({ "r.ts": src }, arr())
  expect(t.get("r.ts")).toContain("  other(),\n  storageRoute,\n]")
})

it("addArrayItem fails when the array is missing", async () => {
  const e = await fail(new Map([["r.ts", "export const x = 1\n"]]), arr())
  expect(e).toBeInstanceOf(TransformAnchorMissing)
  expect((e as TransformAnchorMissing).anchor).toContain("workerRoutes")
})

// ---- setWranglerValue
const setDev: TransformCall = {
  name: "setWranglerValue",
  args: { key: "dev.enable_containers", value: "false" },
}

it("setWranglerValue sets a dotted path when absent, keeps comments, and never overwrites", async () => {
  const tree = await once({ [WF]: '{\n  // keep\n  "name": "app"\n}\n' }, setDev)
  expect(tree.get(WF)).toContain("// keep")
  expect(parse(tree.get(WF) as string).dev).toEqual({ enable_containers: false })
  const mine = await once({ [WF]: '{ "dev": { "enable_containers": true } }' }, setDev)
  expect(parse(mine.get(WF) as string).dev.enable_containers).toBe(true)
})

it("setWranglerValue reports a value that is not JSON instead of crashing", async () => {
  const e = (await fail(new Map([[WF, "{}"]]), {
    name: "setWranglerValue",
    args: { key: "dev.x", value: "{oops" },
  })) as TransformAnchorMissing
  expect(e).toBeInstanceOf(TransformAnchorMissing)
  expect(e.anchor).toContain("valid JSON value")
  expect(e.anchor).toContain("{oops")
})

it("setWranglerValue reports a missing file", async () => {
  expect(((await fail(new Map(), setDev)) as TransformAnchorMissing).anchor).toBe("file")
})

// ---- appendAgentsSection
const AGENTS = "# Agents\n\nBody\n\n<!-- efforge:agents -->\n"
const section = (id: string, content: string): TransformCall => ({
  name: "appendAgentsSection",
  args: { id, content },
})

it("appendAgentsSection inserts before the footer, once per id, in order", async () => {
  const a = await once({ "AGENTS.md": AGENTS }, section("db", "## Database\nUse migrations.\n"))
  expect(a.get("AGENTS.md")).toBe(
    "# Agents\n\nBody\n\n<!-- efforge:section:db -->\n## Database\nUse migrations.\n\n<!-- efforge:agents -->\n",
  )
  const b = await once(Object.fromEntries(a), section("rt", "## Realtime"))
  expect(b.get("AGENTS.md")).toBe(
    "# Agents\n\nBody\n\n<!-- efforge:section:db -->\n## Database\nUse migrations.\n\n<!-- efforge:section:rt -->\n## Realtime\n\n<!-- efforge:agents -->\n",
  )
  const c = await run(b, section("db", "## Changed"))
  expect(c).toBe(b)
})

it("appendAgentsSection appends when the footer is gone and fails without AGENTS.md", async () => {
  const t = await once({ "AGENTS.md": "# Agents\n" }, section("x", "## X"))
  expect(t.get("AGENTS.md")).toBe("# Agents\n\n<!-- efforge:section:x -->\n## X\n")
  const e = await fail(new Map(), section("x", "## X"))
  expect(e).toBeInstanceOf(TransformAnchorMissing)
})

// ---- addWorkflowSecret
const deployYml = readFileSync(
  new URL("../templates/infra/alchemy/files/github/deploy.yml", import.meta.url),
  "utf8",
)
const secret = (name = "BETTER_AUTH_SECRET"): TransformCall => ({
  name: "addWorkflowSecret",
  args: { name },
})

it("addWorkflowSecret adds one env line before CI, keeps everything else, idempotently", async () => {
  const out = await once({ ".github/workflows/deploy.yml": deployYml }, secret())
  const yml = out.get(".github/workflows/deploy.yml") as string
  expect(yml).toBe(
    deployYml.replace(
      '  CI: "true"\n',
      `  BETTER_AUTH_SECRET: \${{ secrets.BETTER_AUTH_SECRET }}\n  CI: "true"\n`,
    ),
  )
})

it("addWorkflowSecret leaves a secret that is already listed alone", async () => {
  const tree = new Map([[".github/workflows/deploy.yml", deployYml]])
  const out = await run(tree, secret("DATABASE_URL"))
  expect(out).toBe(tree)
})

it("addWorkflowSecret fails with a snippet when there is no workflow or no env map", async () => {
  const noFile = await fail(new Map(), secret())
  expect(noFile).toBeInstanceOf(TransformAnchorMissing)
  const noEnv = await fail(new Map([[".github/workflows/deploy.yml", "name: Deploy\n"]]), secret())
  expect(noEnv).toBeInstanceOf(TransformAnchorMissing)
  expect(noEnv).toMatchObject({ snippet: expect.stringContaining("secrets.BETTER_AUTH_SECRET") })
})

it("addWorkflowSecret appends to an env map without CI, matching its indentation", async () => {
  const out = await once(
    {
      ".github/workflows/deploy.yml": `on: push\nenv:\n    A: \${{ secrets.A }} # keep\njobs: {}\n`,
    },
    secret("B"),
  )
  expect(out.get(".github/workflows/deploy.yml")).toBe(
    `on: push\nenv:\n    A: \${{ secrets.A }} # keep\n    B: \${{ secrets.B }}\njobs: {}\n`,
  )
})

// ---- addArrayItem on `as const` arrays
it("addArrayItem appends to an `as const` array", async () => {
  const t = await once(
    { "a.ts": 'export const tabs = [\n  { to: "/a" },\n] as const\n' },
    { name: "addArrayItem", args: { file: "a.ts", name: "tabs", item: '{ to: "/b" }' } },
  )
  expect(t.get("a.ts")).toContain('{ to: "/b" }')
  expect(t.get("a.ts")).toContain("] as const")
})

// ---- addServerFnMiddleware
const fns = `import { createServerFn } from "@tanstack/react-start"

export const a = createServerFn({ method: "POST" })
  .validator(v)
  .handler(() => 1)

export const b = createServerFn({ method: "GET" }).handler(() => 2)
`
const gate: TransformCall = {
  name: "addServerFnMiddleware",
  args: { file: "f.ts", middleware: "requireSession", import: "requireSession", from: "./rs" },
}

it("addServerFnMiddleware gates every server fn once and adds the import", async () => {
  const t = await once({ "f.ts": fns }, gate)
  const text = t.get("f.ts") ?? ""
  expect(text.match(/\.middleware\(\[requireSession\]\)/g)).toHaveLength(2)
  expect(text).toContain('import { requireSession } from "./rs"')
})

it("addServerFnMiddleware leaves an already gated server fn alone and reports missing anchors", async () => {
  const gated = "export const a = createServerFn().middleware([mine]).handler(() => 1)\n"
  const t = await once({ "f.ts": gated }, gate)
  expect(t.get("f.ts")).not.toContain("requireSession]")
  const e = await fail(new Map([["f.ts", "export const x = 1\n"]]), gate)
  expect(e).toBeInstanceOf(TransformAnchorMissing)
})

// ---- addDevVar
it("addDevVar creates .dev.vars, appends, and never overwrites", async () => {
  const dv = (name: string, value: string): TransformCall => ({
    name: "addDevVar",
    args: { name, value },
  })
  const t1 = await once({}, dv("A", "1"))
  expect(t1.get(".dev.vars")).toMatch(/^# Local development secrets[\s\S]*\nA=1\n$/)
  const t2 = await run(t1, dv("B", "2"))
  const t3 = await run(t2, dv("A", "other"))
  expect(t3.get(".dev.vars")).toMatch(/A=1\nB=2\n$/)
})
