import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, it } from "vitest"
import { manifestSchemaUrl } from "../src/manifest.ts"
import { jsonSchemaFile, published } from "../src/schemas.ts"

const root = new URL("..", import.meta.url).pathname

it.each(Object.entries(published))("schemas/%s is current (node scripts/schemas.ts)", (name, s) => {
  expect(readFileSync(join(root, "schemas", name), "utf8")).toBe(jsonSchemaFile(name, s))
})

it("the package ships schemas/, and efforge.jsonc points at a file in it", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  expect(pkg.files).toContain("schemas")
  expect(Object.keys(published)).toContain(manifestSchemaUrl("1.2.3").split("/").pop())
  expect(manifestSchemaUrl("1.2.3")).toBe(
    "https://unpkg.com/create-efforge@1.2.3/schemas/efforge.schema.json",
  )
})
