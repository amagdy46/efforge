import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { NodeFileSystem } from "@effect/platform-node"
import { describe, it } from "@effect/vitest"
import { Effect, FileSystem, Path } from "effect"
import { loadAddons } from "../../src/addon.ts"
import { generate } from "../../src/generate.ts"
import { type StackConfig, withDefaults } from "../../src/stack.ts"
import type { Tree } from "../../src/tree.ts"

const templates = new URL("../../templates", import.meta.url).pathname

const writeTree = (dir: string, tree: Tree) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    for (const [file, content] of tree) {
      const target = path.join(dir, file)
      yield* fs.makeDirectory(path.dirname(target), { recursive: true })
      yield* fs.writeFileString(target, content)
    }
  })

const sh = (cwd: string, command: string) => {
  const r = spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
  })
  if (r.status !== 0) throw new Error(`\`${command}\` exited ${r.status}\n${r.stdout}\n${r.stderr}`)
}

/** Generates `config` into a tmp dir, installs, then typechecks, lints and builds it. */
const buildStack = (config: StackConfig): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const tree = yield* generate(config, yield* loadAddons(templates))
    const dir = mkdtempSync(`${tmpdir()}/efforge-${config.name}-`)
    yield* writeTree(dir, tree)
    yield* Effect.try(() => {
      sh(dir, "pnpm install --no-frozen-lockfile")
      // what `create` runs after installing, before the project's first lint
      spawnSync("pnpm exec biome check --write .", { cwd: dir, shell: true })
      sh(dir, "pnpm typecheck && pnpm lint && pnpm build")
    })
    rmSync(dir, { recursive: true, force: true })
  }).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Path.layer))

const stacks: Array<[string, Parameters<typeof withDefaults>[0]]> = [
  [
    "minimal",
    {
      name: "minimal",
      database: "none",
      orm: "none",
      auth: "none",
      infra: "none",
      ai: "none",
      extras: [],
    },
  ],
  [
    "pg-drizzle",
    { name: "pg-drizzle", database: "postgres", orm: "drizzle", auth: "none", infra: "none" },
  ],
  [
    "d1-effect-sql",
    { name: "d1-effect-sql", database: "d1", orm: "effect-sql", auth: "none", infra: "none" },
  ],
  [
    "extras-no-db",
    {
      name: "extras-no-db",
      database: "none",
      orm: "none",
      auth: "none",
      infra: "none",
      ai: "none",
      extras: ["storage", "workflows", "realtime", "browser"],
    },
  ],
  [
    "pg-drizzle-extras",
    {
      name: "pg-drizzle-extras",
      database: "postgres",
      orm: "drizzle",
      auth: "none",
      infra: "none",
      extras: ["storage", "workflows", "realtime"],
    },
  ],
]

describe("stacks build", () => {
  for (const [name, partial] of stacks)
    it.effect(name, () => buildStack(withDefaults(partial)), { timeout: 15 * 60 * 1000 })
})
