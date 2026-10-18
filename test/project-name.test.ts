import { expect, it } from "vitest"
import { applyProjectName } from "../src/projectName.ts"
import type { Tree } from "../src/tree.ts"

const tree = (): Tree =>
  new Map([
    ["package.json", '{\n  "name": "app",\n  "private": true\n}\n'],
    ["wrangler.jsonc", '{\n  // keep me\n  "name": "app",\n  "main": "x"\n}\n'],
    ["README.md", "# My app\n\nBody\n\n# Second heading\n"],
    ["apps/web/package.json", '{ "name": "web" }\n'],
  ])

it("renames the root package, wrangler config and README heading", () => {
  const out = applyProjectName(tree(), "spoorline")
  expect(JSON.parse(out.get("package.json") as string)).toEqual({
    name: "spoorline-monorepo",
    private: true,
  })
  expect(out.get("wrangler.jsonc")).toBe(
    '{\n  // keep me\n  "name": "spoorline",\n  "main": "x"\n}\n',
  )
  expect(out.get("README.md")).toBe("# spoorline\n\nBody\n\n# Second heading\n")
  expect(out.get("apps/web/package.json")).toBe('{ "name": "web" }\n')
})

it("uses the last segment of a scoped name", () => {
  const out = applyProjectName(tree(), "@acme/shop")
  expect(JSON.parse(out.get("package.json") as string).name).toBe("shop-monorepo")
})

it("skips files that are absent and is idempotent", () => {
  const t: Tree = new Map([["package.json", '{"name":"app"}']])
  const once = applyProjectName(t, "x")
  expect([...once.keys()]).toEqual(["package.json"])
  expect(applyProjectName(once, "x")).toEqual(once)
})

it("names the Alchemy stack after the project, as a lowercase slug", () => {
  const t: Tree = new Map([
    ["infra/alchemy.run.ts", 'export default Alchemy.Stack(\n  "app",\n  {},\n  gen,\n)\n'],
  ])
  const out = applyProjectName(t, "@acme/My_Shop.v2")
  expect(out.get("infra/alchemy.run.ts")).toContain('Alchemy.Stack(\n  "my-shop-v2",')
  expect(applyProjectName(out, "@acme/My_Shop.v2")).toEqual(out)
})
