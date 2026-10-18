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
    name: "spoorline",
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
  expect(JSON.parse(out.get("package.json") as string).name).toBe("shop")
})

it("skips files that are absent and is idempotent", () => {
  const t: Tree = new Map([["package.json", '{"name":"app"}']])
  const once = applyProjectName(t, "x")
  expect([...once.keys()]).toEqual(["package.json"])
  expect(applyProjectName(once, "x")).toEqual(once)
})
