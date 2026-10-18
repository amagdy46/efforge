import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  runTransform,
  TransformAnchorMissing,
  type TransformCall,
} from "../src/transforms/index.ts"
import type { Tree } from "../src/tree.ts"

const run = (tree: Tree, t: TransformCall) => Effect.runPromise(runTransform(tree, t))
const fail = async (tree: Tree, t: TransformCall) =>
  (await Effect.runPromise(Effect.flip(runTransform(tree, t)))) as TransformAnchorMissing
const once = async (files: Record<string, string>, t: TransformCall) => {
  const a = await run(new Map(Object.entries(files)), t)
  expect(Object.fromEntries(await run(a, t))).toEqual(Object.fromEntries(a))
  return a
}
const F = "l.ts"
const addLayer: TransformCall = {
  name: "addLayer",
  args: { file: F, import: "Db", from: "@db", layer: "Db" },
}

it("addLayer: wrapped args with comments", async () => {
  const src = `import { Layer } from "effect"\nexport const AppLayer = Layer.mergeAll(\n  A, // a\n  B, // b\n)\n`
  const t = await once({ [F]: src }, addLayer)
  expect(t.get(F)).toContain("  B, // b\n  Db,\n)")
  const src2 = `import { Layer } from "effect"\nexport const AppLayer = Layer.mergeAll(\n  A,\n  // trailing comment\n  B // b\n)\n`
  const t2 = await once({ [F]: src2 }, addLayer)
  expect(t2.get(F)).toMatch(/B,? \/\/ b|B \/\/ b/)
  expect(t2.get(F)).toContain("Db")
})

it("addLayer: pipe-wrapped mergeAll fails clearly", async () => {
  const src = `export const AppLayer = Layer.mergeAll(A, B).pipe(Layer.provide(X))\n`
  const e = await fail(new Map([[F, src]]), addLayer)
  expect(e).toBeInstanceOf(TransformAnchorMissing)
  expect(e.snippet).toContain("Db")
})

it("addLayer: decoys in strings/comments", async () => {
  const src = `// Layer.mergeAll(Z)\nconst s = "Layer.mergeAll(Q)"\nexport const AppLayer = Layer.mergeAll(A)\n`
  const t = await once({ [F]: src }, addLayer)
  expect(t.get(F)).toContain("export const AppLayer = Layer.mergeAll(A, Db)")
  expect(t.get(F)).toContain('"Layer.mergeAll(Q)"')
  expect(t.get(F)).toContain("// Layer.mergeAll(Z)\n")
})

it("addLayer: CRLF + unicode", async () => {
  const src = `import { Layer } from "effect"\r\nconst s = "héllo 🎉 日本"\r\nexport const AppLayer = Layer.mergeAll(\r\n  A,\r\n  B,\r\n)\r\n`
  const t = await once({ [F]: src }, addLayer)
  const out = t.get(F) as string
  expect(out).toContain('const s = "héllo 🎉 日本"')
  expect(out.replace(/\r\n/g, "")).not.toContain("\n")
  expect(out).toContain("  B,\r\n  Db,\r\n)")
})

it("addImport: type-only and default", async () => {
  const call = (imp: string): TransformCall => ({
    name: "addImport",
    args: { file: F, import: imp, from: "m" },
  })
  const a = await once({ [F]: 'import type { X } from "m"\n' }, call("X"))
  expect(a.get(F)).toBe('import { X } from "m"\n') // promoted: type + value import of X would redeclare it
  const b = await once({ [F]: 'import R from "m"\n' }, call("Y"))
  expect(b.get(F)).toBe('import R, { Y } from "m"\n')
  const c = await once({ [F]: 'import type { X } from "m"\n' }, call("Y"))
  expect(c.get(F)).toContain('import { Y } from "m"')
})

it("addWranglerBinding: same binding different fields is a no-op", async () => {
  const src = `{\n  // c\n  "d1_databases": [{ "binding": "DB", "database_id": "old" }]\n}\n`
  const t = await once(
    { "wrangler.jsonc": src },
    {
      name: "addWranglerBinding",
      args: { key: "d1_databases", value: '{"binding":"DB","database_id":"new"}' },
    },
  )
  expect(t.get("wrangler.jsonc")).toBe(src)
})

const AL = "infra/alchemy.run.ts"
it("addAlchemyResource: missing marker / bindings include code", async () => {
  const args = { name: "db", code: "const db = await D1()" }
  const e1 = await fail(new Map([[AL, "const w = Worker({ bindings: { a } })\n"]]), {
    name: "addAlchemyResource",
    args,
  })
  expect(e1.snippet).toContain("const db = await D1()")
  const e2 = await fail(new Map([[AL, "// efforge:resources\nconst w = Worker({})\n"]]), {
    name: "addAlchemyResource",
    args,
  })
  expect(e2.snippet).toContain("const db = await D1()")
  expect(e2.anchor).toContain("bindings")
})
