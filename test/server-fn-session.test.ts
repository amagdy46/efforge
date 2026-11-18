import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { afterAll, expect, it } from "@effect/vitest"
import { Effect, type Layer } from "effect"
import { loadAddons } from "../src/addon.ts"
import { PUBLIC_SERVER_FNS } from "../src/cards.ts"
import { generate } from "../src/generate.ts"
import { validate } from "../src/rules.ts"
import { type StackConfig, withDefaults } from "../src/stack.ts"
import type { Tree } from "../src/tree.ts"

// On a stack with auth every server function in apps/web requires a session, wherever the add-on
// lists its file, and the generated project enforces that itself (lint/efforge.js, configured in
// its vite.config.ts). Here the real oxlint runs those rules over generated projects.

const repo = new URL("..", import.meta.url).pathname
const templates = join(repo, "templates")
const oxlint = join(repo, "node_modules/.bin/oxlint")
const cache = join(repo, "node_modules/.cache")
mkdirSync(cache, { recursive: true })
const tmp = mkdtempSync(join(cache, "efforge-session-"))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const run = <A, E>(eff: Effect.Effect<A, E, Layer.Success<typeof NodeServices.layer>>) =>
  Effect.runPromise(eff.pipe(Effect.provide(NodeServices.layer)))

/** The `apps/web/**` override of the base template's lint config: the efforge rules and options. */
const { default: viteConfig } = (await import(
  join(templates, "base/files/root/vite.config.ts")
)) as {
  default: { lint: { overrides: Array<{ files: string[]; rules: Record<string, unknown> }> } }
}
const efforgeRules = viteConfig.lint.overrides.find((o) => o.files.includes("apps/web/**"))
  ?.rules as Record<string, [string, Record<string, unknown>]>

interface Diagnostic {
  readonly code: string
  readonly message: string
  readonly filename: string
}

/** The efforge rules' findings on the TypeScript files under apps/web of `tree`, written to `dir`. */
const lint = (dir: string, tree: Tree): Diagnostic[] => {
  rmSync(dir, { recursive: true, force: true })
  const files = [...tree.keys()].filter(
    (f) => f.startsWith("apps/web/src/") && /\.tsx?$/.test(f) && !f.endsWith(".d.ts"),
  )
  for (const f of [...files, "lint/efforge.js"]) {
    mkdirSync(dirname(join(dir, f)), { recursive: true })
    writeFileSync(join(dir, f), tree.get(f) ?? "")
  }
  writeFileSync(
    join(dir, "oxlint.json"),
    JSON.stringify({
      jsPlugins: [join(dir, "lint/efforge.js")],
      categories: { correctness: "off" },
      overrides: [{ files: ["apps/web/**"], rules: efforgeRules }],
    }),
  )
  const out = spawnSync(oxlint, ["-c", "oxlint.json", "--no-ignore", "-f", "json", ...files], {
    cwd: dir,
    encoding: "utf8",
  })
  const report = JSON.parse(out.stdout) as { diagnostics: Diagnostic[] }
  return report.diagnostics.filter((d) => d.code.startsWith("efforge("))
}

const stack = (config: Record<string, unknown>): StackConfig =>
  withDefaults({
    name: "app",
    database: "d1",
    orm: "drizzle",
    auth: "better-auth",
    infra: "none",
    ai: "none",
    extras: [],
    ...config,
  } as never)

const EXTRAS: ReadonlyArray<string> = ["workflows", "realtime", "browser", "storage", "email"]

it("lint/efforge.js and src/cards.ts list the same public server functions", () => {
  expect(efforgeRules["efforge/server-fn-session"]?.[1]).toEqual({ public: PUBLIC_SERVER_FNS })
})

it("every stack's own lint passes: each server function is guarded on auth stacks", async () => {
  const addons = await run(loadAddons(templates))
  let stacks = 0
  for (const auth of ["better-auth", "better-auth-orgs", "none"])
    for (const orm of ["drizzle", "effect-sql"])
      for (const database of ["d1", "postgres"])
        for (const ai of ["none", "effect-ai-byok"]) {
          const config = stack({ auth, orm, database, ai, extras: EXTRAS })
          if ((await Effect.runPromise(Effect.result(validate(config))))._tag === "Failure")
            continue
          const tree = await run(generate(config, addons))
          expect(lint(join(tmp, "stack"), tree), `${auth} ${orm} ${database} ${ai}`).toEqual([])
          stacks++
        }
  expect(stacks).toBeGreaterThanOrEqual(16)
}, 180_000)

it("the rule names an unguarded server function on an auth stack, and is off without auth", async () => {
  const addons = await run(loadAddons(templates))
  const handwritten = [
    'import { createServerFn } from "@tanstack/react-start"',
    "",
    'export const exportAll = createServerFn({ method: "GET" }).handler(() => "rows")',
    "",
  ].join("\n")
  const withAuth = new Map(await run(generate(stack({}), addons))).set(
    "apps/web/src/server/export.ts",
    handwritten,
  )
  const found = lint(join(tmp, "auth"), withAuth)
  expect(found).toHaveLength(1)
  expect(found[0]?.message).toMatch(
    /^`exportAll` in apps\/web\/src\/server\/export\.ts runs without a session\..*\.middleware\(\[requireSession\]\)/,
  )
  const without = new Map(await run(generate(stack({ auth: "none" }), addons))).set(
    "apps/web/src/server/export.ts",
    handwritten,
  )
  expect(lint(join(tmp, "none"), without)).toEqual([])
})

it("lint refuses whole-file imports and allows ?region= and stylesheet URLs", async () => {
  const addons = await run(loadAddons(templates))
  const tree = new Map(await run(generate(stack({}), addons))).set(
    "apps/web/src/capabilities/leak.ts",
    [
      'import env from "../../../../.dev.vars?raw"',
      'import live from "../server/auth-live.ts?raw&region=card"',
      'import url from "../server/notes.ts?url"',
      'import shown from "../server/notes.ts?region=card"',
      'import css from "../styles.css?url"',
      'const all = import.meta.glob("../server/*.ts", { query: "?raw" })',
      "export const leak = [env, live, url, shown, css, all]",
      "",
    ].join("\n"),
  )
  const found = lint(join(tmp, "raw"), tree).filter((d) => d.code.includes("no-whole-file"))
  expect(found.map((d) => /`([^`]+)`/.exec(d.message)?.[1])).toEqual([
    "../../../../.dev.vars?raw",
    "../server/auth-live.ts?raw&region=card",
    "../server/notes.ts?url",
    "glob?raw",
  ])
})

/** A copy of the templates where `extras/email` is a throwaway add-on with one file, `file`. */
const withLeaky = (file: string, source: string): string => {
  const root = join(tmp, `templates-${Math.random().toString(36).slice(2)}`)
  cpSync(templates, root, { recursive: true })
  const dir = join(root, "extras/email")
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, "files"), { recursive: true })
  writeFileSync(join(dir, "files/fn.ts"), source)
  writeFileSync(
    join(dir, "addon.json"),
    JSON.stringify({
      id: "extras/email",
      title: "Leaky",
      description: "A throwaway add-on that lists its server function under files, not card.files",
      files: [{ path: "files/fn.ts", target: file }],
      dependencies: {},
      devDependencies: {},
      envVars: [],
      requires: [],
      conflicts: [],
      transforms: [],
    }),
  )
  return root
}

it("an add-on's server function listed under files, not card.files, is guarded too", async () => {
  const target = "apps/web/src/server/email/send-test-email.ts"
  const root = withLeaky(
    target,
    [
      'import { createServerFn } from "@tanstack/react-start"',
      "",
      'export const sendTestEmail = createServerFn({ method: "POST" }).handler(() => "sent")',
      "",
    ].join("\n"),
  )
  const addons = await run(loadAddons(root))
  expect(addons.get("extras/email")?.manifest.transforms).toEqual([
    expect.objectContaining({
      name: "addServerFnMiddleware",
      args: expect.objectContaining({ file: target, from: "../require-session" }),
    }),
  ])
  const tree = await run(generate(stack({ extras: ["email"] }), addons))
  expect(tree.get(target)).toContain(".middleware([requireSession])")
  expect(tree.get(target)).toContain('import { requireSession } from "../require-session"')
  expect(lint(join(tmp, "leaky"), tree)).toEqual([])
  // without auth the add-on's function stays as written
  const open = await run(generate(stack({ auth: "none", extras: ["email"] }), addons))
  expect(open.get(target)).not.toContain("requireSession")
})

it("an add-on whose middleware efforge cannot edit fails the project's lint, naming the function", async () => {
  const target = "apps/web/src/server/send.ts"
  const root = withLeaky(
    target,
    [
      'import { createServerFn } from "@tanstack/react-start"',
      'import { shared } from "./middleware"',
      "",
      'export const send = createServerFn({ method: "POST" }).middleware(shared).handler(() => 1)',
      "",
    ].join("\n"),
  )
  const tree = await run(generate(stack({ extras: ["email"] }), await run(loadAddons(root))))
  expect(tree.get(target)).not.toContain("requireSession")
  expect(lint(join(tmp, "uneditable"), tree).map((d) => d.message)).toEqual([
    expect.stringMatching(/^`send` in apps\/web\/src\/server\/send\.ts runs without a session/),
  ])
})
