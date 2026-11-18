// Writes schemas/*.schema.json from src/schemas.ts. test/schemas.test.ts fails when they are stale.
//   node scripts/schemas.ts
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { jsonSchemaFile, published } from "../src/schemas.ts"

const dir = new URL("../schemas", import.meta.url).pathname
mkdirSync(dir, { recursive: true })
for (const [name, schema] of Object.entries(published)) {
  writeFileSync(join(dir, name), jsonSchemaFile(name, schema))
  console.log(`schemas/${name}`)
}
