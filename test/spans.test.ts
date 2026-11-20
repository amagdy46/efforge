import { readFileSync } from "node:fs"
import { join } from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect, type FileSystem, Path } from "effect"
import { Node, SyntaxKind } from "ts-morph"
import { loadAddons } from "../src/addon.ts"
import { parseTs } from "../src/transforms/util.ts"

// Every method of a live layer is a named span: `Effect.withSpan("<Service>.<method>")`. Without
// a tracer that costs nothing; with one (the telemetry slot in layers.ts), a trace reads by name.
// This runs over every add-on's templates, so a new add-on cannot forget. Test layers (in-memory,
// fixed) are exempt: they never run in production.

const templates = new URL("../templates", import.meta.url).pathname
const run = <A, E>(eff: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.runPromise(eff.pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Path.layer)))

/** Files a layer runs in production: apps/web and packages/db, not tests or test layers. */
const live = (target: string) =>
  /^(apps\/web\/src\/server|packages\/db\/src)\/.*\.ts$/.test(target) &&
  !/\.test\.ts$|-in-memory\.ts$|-fixed\.ts$/.test(target)

/** `<Service>.<member>` for each Effect-valued member of each `Service.of({ ... })` without its span. */
export const unspanned = (file: string, text: string): string[] => {
  const out: string[] = []
  for (const call of parseTs(file, text).getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression()
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== "of") continue
    const service = callee.getExpression().getText()
    if (!/^[A-Z]\w*$/.test(service)) continue
    const object = call.getArguments()[0]
    if (object === undefined || !Node.isObjectLiteralExpression(object)) continue
    for (const member of object.getProperties()) {
      // `{ from }` is data the layer already has; a spread is checked where it is built
      if (!Node.isPropertyAssignment(member) && !Node.isMethodDeclaration(member)) continue
      const name = member.getName()
      const value = Node.isPropertyAssignment(member) ? member.getInitializer() : member
      // data, not an operation: `transport: "console"`, `from`
      if (
        value === undefined ||
        Node.isStringLiteral(value) ||
        Node.isNumericLiteral(value) ||
        Node.isIdentifier(value) ||
        Node.isNoSubstitutionTemplateLiteral(value)
      )
        continue
      if (!value.getText().includes(`Effect.withSpan("${service}.${name}")`))
        out.push(`${service}.${name}`)
    }
  }
  return out
}

it("every method of every live layer is a span named <Service>.<method>", async () => {
  const addons = await run(loadAddons(templates))
  const missing: string[] = []
  let checked = 0
  for (const [id, { dir, manifest }] of addons)
    for (const f of [...manifest.files, ...(manifest.card?.files ?? [])]) {
      if (!live(f.target)) continue
      const text = readFileSync(join(dir, f.path), "utf8")
      if (!text.includes(".of(")) continue
      checked += 1
      for (const m of unspanned(f.target, text)) missing.push(`${id} ${f.target}: ${m}`)
    }
  expect(checked).toBeGreaterThan(10)
  expect(missing).toEqual([])
})

it("the check catches a member without its span, and skips plain data", () => {
  const text = `export const L = Layer.succeed(Mailer, Mailer.of({
    transport: "console",
    from,
    send: (m) => Effect.log(m).pipe(Effect.withSpan("Mailer.send")),
    peek: Effect.void,
  }))`
  expect(unspanned("a.ts", text)).toEqual(["Mailer.peek"])
})
