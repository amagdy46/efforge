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
  expect(t1.get("a.ts")).toBe('import { x } from "y"\nimport { Foo } from "foo"\nconst a = 1\n')
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

it("addLayer fills the empty mergeAll and is idempotent", async () => {
  const tree = await once({ [LF]: layers() }, addLayer())
  expect(tree.get(LF)).toBe(
    `import { Layer } from "effect"\nimport { DbLive } from "@app/db"\n\nexport const AppLayer = Layer.mergeAll(/* efforge:layers */ DbLive)\n`,
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
  expect(e2.anchor).toContain("bindings")
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

it("setWranglerValue reports a missing file", async () => {
  expect(((await fail(new Map(), setDev)) as TransformAnchorMissing).anchor).toBe("file")
})
