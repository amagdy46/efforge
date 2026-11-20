import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { afterEach, beforeEach, expect, it } from "@effect/vitest"
import { Effect, type Layer } from "effect"
import { parse } from "yaml"
import { loadAddons } from "../src/addon.ts"
import { addAddons } from "../src/commands/add.ts"
import { defaultTemplatesDir } from "../src/commands/create.ts"
import { generate } from "../src/generate.ts"
import { withDefaults } from "../src/stack.ts"
import {
  effectLockstep,
  efforgeVersion,
  isEffectLockstep,
  overrideKey,
  pnpmVersion,
  versions,
} from "../src/versions.ts"
import { writeTree } from "../src/write.ts"

// The drift that broke 0.2.0 stacks: drizzle-orm and effect-cf peer on `@effect/sql-*: >=4.0.0`,
// so pnpm installed the newest @effect/sql-d1 and @effect/sql-sqlite-do next to the pinned
// `effect`. The generated workspace must hold every Effect package at the `effect` pin.

const run = <A, E>(eff: Effect.Effect<A, E, Layer.Success<typeof NodeServices.layer>>) =>
  Effect.runPromise(eff.pipe(Effect.provide(NodeServices.layer)))

const effect = versions.effect as string

/**
 * pnpm's override lookup for one name at an Effect 4 version: an exact key, a key scoped to
 * Effect 4 (`effect@>=4.0.0-0`), else a `*` pattern.
 */
const overrideFor = (overrides: Record<string, string>, name: string): string | undefined =>
  overrides[name] ??
  overrides[`${name}@>=4.0.0-0`] ??
  Object.entries(overrides).find(([k]) => k.endsWith("*") && name.startsWith(k.slice(0, -1)))?.[1]

// Every package Effect-TS/effect-smol publishes, including ones that only arrive as a peer or a
// dependency of another package (@effect/platform-node-shared, @effect/platform-browser from
// effect-cf, the sql drivers drizzle-orm peers on).
const effectSmol = [
  "effect",
  "@effect/ai-amazon-bedrock",
  "@effect/ai-anthropic",
  "@effect/ai-openai",
  "@effect/ai-openai-compat",
  "@effect/ai-openrouter",
  "@effect/atom-react",
  "@effect/atom-solid",
  "@effect/atom-vue",
  "@effect/openapi-generator",
  "@effect/opentelemetry",
  "@effect/platform-browser",
  "@effect/platform-bun",
  "@effect/platform-deno",
  "@effect/platform-node",
  "@effect/platform-node-shared",
  "@effect/sql-clickhouse",
  "@effect/sql-d1",
  "@effect/sql-libsql",
  "@effect/sql-mssql",
  "@effect/sql-mysql2",
  "@effect/sql-pg",
  "@effect/sql-pglite",
  "@effect/sql-sqlite-bun",
  "@effect/sql-sqlite-do",
  "@effect/sql-sqlite-node",
  "@effect/sql-sqlite-react-native",
  "@effect/sql-sqlite-wasm",
  "@effect/vitest",
]

it("every Effect package efforge pins is in lockstep with effect", () => {
  for (const name of Object.keys(versions).filter(
    (n) => n === "effect" || n.startsWith("@effect/"),
  ))
    if (name === "@effect/tsgo") expect(isEffectLockstep(name)).toBe(false)
    else {
      expect(isEffectLockstep(name), name).toBe(true)
      expect(versions[name], name).toBe(effect)
    }
})

it("the generated workspace pins every effect-smol package, and nothing else under @effect", async () => {
  const tree = await run(
    Effect.gen(function* () {
      return yield* generate(withDefaults({ name: "app" }), yield* loadAddons(defaultTemplatesDir))
    }),
  )
  const ws = parse(tree.get("pnpm-workspace.yaml") as string) as {
    overrides: Record<string, string>
    catalog: Record<string, string>
  }
  for (const name of effectSmol) expect(overrideFor(ws.overrides, name), name).toBe(effect)
  expect(ws.catalog.effect).toBe(effect)
  // versioned on their own: the guard must leave them alone
  for (const name of ["@effect/tsgo", "@effect/tsgo-linux-x64", "@effect/language-service"])
    expect(overrideFor(ws.overrides, name), name).toBeUndefined()
  expect(ws.overrides.vite).toBe("catalog:")
  expect(Object.keys(ws.overrides)).toEqual(["vite", ...effectLockstep.map(overrideKey)])
  // scoped to Effect 4: a library that depends on Effect 3 (uploadthing) keeps its own copy
  expect(ws.overrides.effect).toBeUndefined()
  expect(ws.overrides["effect@>=4.0.0-0"]).toBe(effect)
})

it("generated projects pin the pnpm that honours the guard", () => {
  const pkg = JSON.parse(
    readFileSync(join(defaultTemplatesDir, "base/files/root/package.json"), "utf8"),
  ) as { packageManager: string }
  expect(pkg.packageManager).toBe(`pnpm@${pnpmVersion}`)
})

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "efforge-lockstep-"))
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

it("add restores the guard on an older project, at that project's effect version", async () => {
  const dir = join(tmp, "app")
  const tree = await run(
    Effect.gen(function* () {
      return yield* generate(
        withDefaults({ name: "app", database: "d1", orm: "effect-sql", auth: "none" }),
        yield* loadAddons(defaultTemplatesDir),
      )
    }),
  )
  await run(writeTree(dir, tree))
  // a project made by 0.2.0: effect 4.0.5 in the catalog, no Effect overrides
  const file = join(dir, "pnpm-workspace.yaml")
  const old = parse(readFileSync(file, "utf8")) as {
    overrides: Record<string, string>
    catalog: Record<string, string>
  }
  for (const k of Object.keys(old.overrides)) if (k !== "vite") delete old.overrides[k]
  for (const k of Object.keys(old.catalog)) if (isEffectLockstep(k)) old.catalog[k] = "4.0.5"
  writeFileSync(file, `${JSON.stringify(old, null, 2)}\n`)

  await run(
    addAddons(dir, ["ai/effect-ai-byok"], { overwrite: false, dryRun: false, install: false }),
  )
  const ws = parse(readFileSync(file, "utf8")) as {
    overrides: Record<string, string>
    catalog: Record<string, string>
  }
  for (const name of effectSmol) expect(overrideFor(ws.overrides, name), name).toBe("4.0.5")
  // the new AI packages join at the project's effect, not efforge's newest pin
  expect(ws.catalog["@effect/ai-anthropic"]).toBe("4.0.5")
  expect(ws.catalog.effect).toBe("4.0.5")
})

// What 0.2.0 really generated (test/fixtures/v0.2.0/README.md): packageManager pnpm@12.4.2, which
// accepts the wildcard overrides and ignores them, so `add` must raise it for the guard to work.
// Recorded as this efforge's own line: `add` refuses a project from an older one (UpgradeFirst),
// and puts the guard back on one of its own that has lost it.
const v020 = join(import.meta.dirname, "fixtures/v0.2.0/d1-effect-sql-auth")
const copyWithoutGuard = (dir: string) => {
  cpSync(v020, dir, { recursive: true })
  const m = join(dir, "efforge.jsonc")
  writeFileSync(
    m,
    readFileSync(m, "utf8").replace(
      /"efforgeVersion": "[^"]*"/,
      `"efforgeVersion": "${efforgeVersion}"`,
    ),
  )
}

it("add on a project without the guard writes it and raises packageManager so pnpm honours it", async () => {
  const dir = join(tmp, "old")
  copyWithoutGuard(dir)
  const result = await run(
    addAddons(dir, ["email"], { overwrite: false, dryRun: false, install: false }),
  )
  expect(result.packageManager).toEqual({ from: "pnpm@12.4.2", to: `pnpm@${pnpmVersion}` })
  expect(result.written).toContain("package.json")
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>
  expect(pkg.packageManager).toBe(`pnpm@${pnpmVersion}`)
  expect(Object.keys(pkg).at(-1)).toBe("packageManager")
  const ws = parse(readFileSync(join(dir, "pnpm-workspace.yaml"), "utf8")) as {
    overrides: Record<string, string>
  }
  for (const name of effectSmol) expect(overrideFor(ws.overrides, name), name).toBe("4.0.5")
  expect(ws.overrides.vite).toBe("catalog:")
})

it("add never lowers packageManager, and leaves one new enough alone", async () => {
  for (const pm of [`pnpm@${pnpmVersion}`, "pnpm@13.0.0", "pnpm@12.17.0"]) {
    const dir = join(tmp, pm)
    copyWithoutGuard(dir)
    const file = join(dir, "package.json")
    writeFileSync(file, readFileSync(file, "utf8").replace("pnpm@12.4.2", pm))
    const result = await run(
      addAddons(dir, ["email"], { overwrite: false, dryRun: false, install: false }),
    )
    expect(result.packageManager, pm).toBeNull()
    expect(
      (JSON.parse(readFileSync(file, "utf8")) as { packageManager: string }).packageManager,
    ).toBe(pm)
  }
})

it("add keeps an unscoped effect override written by hand", async () => {
  const dir = join(tmp, "hand")
  copyWithoutGuard(dir)
  const file = join(dir, "pnpm-workspace.yaml")
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace('  vite: "catalog:"', '  vite: "catalog:"\n  effect: 4.0.5'),
  )
  await run(addAddons(dir, ["email"], { overwrite: false, dryRun: false, install: false }))
  const ws = parse(readFileSync(file, "utf8")) as { overrides: Record<string, string> }
  expect(ws.overrides.effect).toBe("4.0.5")
  expect(ws.overrides["effect@>=4.0.0-0"]).toBeUndefined()
})
