import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { NodeServices } from "@effect/platform-node"
import { afterAll, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { loadAddons } from "../src/addon.ts"
import { defaultTemplatesDir } from "../src/commands/create.ts"
import { generate } from "../src/generate.ts"
import { type StackConfig, withDefaults } from "../src/stack.ts"

// The generated project's `pnpm check` must pass straight after `create --no-install`, so the
// templates, and what transforms insert into them, have to already be formatted with the
// generated vite.config.ts fmt settings. `vp` comes from this repo's node_modules.

const repo = new URL("..", import.meta.url).pathname
const vp = join(repo, "node_modules/.bin/vp")
const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

const scratch = () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "efforge-fmt-"))
  roots.push(dir)
  symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"))
  spawnSync("git", ["init", "-q"], { cwd: dir })
  return dir
}

const fmtCheck = (dir: string) => {
  const r = spawnSync(vp, ["fmt", "--check"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  })
  return { ok: r.status === 0, out: `${r.stdout}\n${r.stderr}` }
}

const generated = (config: StackConfig) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* generate(config, yield* loadAddons(defaultTemplatesDir))
    }).pipe(Effect.provide(NodeServices.layer)),
  )

const stacks: Array<Partial<StackConfig> & { name: string }> = [
  { name: "minimal", database: "none", orm: "none", auth: "none", infra: "none" },
  { name: "pg-orgs", database: "postgres", orm: "drizzle", auth: "better-auth-orgs" },
  {
    name: "house",
    database: "postgres",
    orm: "drizzle",
    auth: "better-auth-orgs",
    infra: "alchemy",
    ai: "effect-ai-byok",
    extras: ["workflows", "realtime", "browser", "storage", "email"],
  },
  {
    name: "d1-sql",
    database: "d1",
    orm: "effect-sql",
    auth: "better-auth",
    infra: "alchemy",
    ai: "effect-ai-byok",
    extras: ["email", "storage"],
  },
  { name: "pg-sql-orgs", database: "postgres", orm: "effect-sql", auth: "better-auth-orgs" },
]

for (const partial of stacks)
  it(`generated ${partial.name} is already formatted (no install, no format step)`, async () => {
    const dir = scratch()
    for (const [file, content] of await generated(withDefaults(partial))) {
      mkdirSync(dirname(join(dir, file)), { recursive: true })
      writeFileSync(join(dir, file), content)
    }
    const r = fmtCheck(dir)
    expect(r.out, "files that need formatting").toContain("Finished")
    expect(r.ok, r.out.slice(-3000)).toBe(true)
  }, 60_000)

it("templates/ conform to the generated fmt config", () => {
  const dir = scratch()
  cpSync(defaultTemplatesDir, join(dir, "templates"), { recursive: true })
  cpSync(join(defaultTemplatesDir, "base/files/root/vite.config.ts"), join(dir, "vite.config.ts"))
  writeFileSync(join(dir, "package.json"), '{\n  "name": "x",\n  "private": true\n}\n')
  // add-on manifests are efforge's own data, not generated code
  writeFileSync(join(dir, ".prettierignore"), "**/addon.json\n")
  const r = fmtCheck(dir)
  expect(r.ok, r.out.slice(-3000)).toBe(true)
}, 60_000)
