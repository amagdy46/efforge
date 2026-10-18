import { NodeFileSystem } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect, Path, Schema } from "effect"
import { vi } from "vitest"
import { loadAddons } from "../src/addon.ts"
import { generate } from "../src/generate.ts"
import { EfforgeManifest, manifestHeader } from "../src/manifest.ts"
import { withDefaults } from "../src/stack.ts"

// A transform that edits a file which is also an overlay target (a "seam" file).
vi.mock("../src/transforms/index.ts", async (orig) => ({
  ...(await orig<typeof import("../src/transforms/index.ts")>()),
  runTransform: (tree: ReadonlyMap<string, string>) =>
    Effect.succeed(new Map(tree).set("apps/web/src/db.ts", "// edited by transform\n")),
}))

const fixtures = new URL("./fixtures/templates", import.meta.url).pathname

it("seam files edited by transforms are not recorded in efforge.jsonc files", async () => {
  const tree = await Effect.runPromise(
    Effect.gen(function* () {
      const addons = new Map(yield* loadAddons(fixtures))
      const l = addons.get("database/postgres")
      if (l === undefined) throw new Error("fixture")
      addons.set("database/postgres", {
        ...l,
        manifest: { ...l.manifest, transforms: [{ name: "x", args: {} }] },
      })
      return yield* generate(withDefaults({ name: "app", auth: "none" }), addons)
    }).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Path.layer)),
  )
  expect(tree.get("apps/web/src/db.ts")).toBe("// edited by transform\n")
  const text = tree.get("efforge.jsonc") as string
  const m = Schema.decodeUnknownSync(EfforgeManifest)(JSON.parse(text.slice(manifestHeader.length)))
  expect(Object.keys(m.files)).not.toContain("apps/web/src/db.ts")
  expect(Object.keys(m.files)).toContain("apps/web/src/schema.ts")
})
