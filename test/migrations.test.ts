import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterAll, expect, it } from "vitest"
import { D1_STATE, localMigrations, migrateOwed } from "../src/migrations.ts"
import type { StackConfig } from "../src/stack.ts"

// `pnpm db:migrate` is owed when the local database lacks a migration, read as doctor reads it,
// not remembered from what a run did: after an add that brings a migration (auth), and after an
// earlier run that never migrated, add says so; when everything is applied, it doesn't.

const bin = new URL("../src/bin.ts", import.meta.url).pathname
const work = mkdtempSync(join(tmpdir(), "efforge-migrations-"))
afterAll(() => rmSync(work, { recursive: true, force: true }))

const efforge = (cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [bin, ...args, "--json"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    timeout: 60_000,
  })
  return JSON.parse(r.stdout) as {
    ok: boolean
    stack: StackConfig
    nextSteps: Array<{ command: string }>
  }
}
const migrates = (doc: { nextSteps: Array<{ command: string }> }) =>
  doc.nextSteps.some((s) => s.command === "pnpm db:migrate")

/** Records `names` as applied in the local D1 database, as wrangler does. */
const applied = (dir: string, names: ReadonlyArray<string>) => {
  const state = join(dir, D1_STATE)
  rmSync(state, { recursive: true, force: true })
  mkdirSync(state, { recursive: true })
  const db = new DatabaseSync(join(state, "local.sqlite"))
  db.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT)")
  for (const n of names) db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(n)
  db.close()
}
const migrateAll = (dir: string, stack: StackConfig) => {
  const local = localMigrations(dir, stack)
  if (!local.known) throw new Error(local.why)
  applied(dir, local.expected)
}

it(
  "create and add say pnpm db:migrate exactly when the local D1 lacks a migration",
  { timeout: 120_000 },
  () => {
    const created = efforge(
      work,
      "create",
      "app",
      "--database=d1",
      "--orm=drizzle",
      "--auth=none",
      "--no-install",
      "--no-git",
    )
    expect(created.ok).toBe(true)
    const dir = join(work, "app")
    // a new project's local database has nothing
    expect(migrates(created)).toBe(true)
    migrateAll(dir, created.stack)
    expect(migrateOwed(dir, created.stack, [])).toBe(false)

    // an add without a migration, everything applied: nothing owed
    expect(migrates(efforge(dir, "add", "email", "--no-install"))).toBe(false)
    // an add that brings one (auth's tables): owed, before and after it writes
    expect(migrates(efforge(dir, "add", "auth/better-auth", "--no-install", "--dry-run"))).toBe(
      true,
    )
    const auth = efforge(dir, "add", "auth/better-auth", "--no-install")
    expect(migrates(auth)).toBe(true)
    expect(migrateOwed(dir, auth.stack, [])).toBe(true)

    // the migration never ran (an interrupted run, a skipped step): the next add still says so
    expect(migrates(efforge(dir, "add", "storage", "--no-install"))).toBe(true)
    migrateAll(dir, auth.stack)
    expect(migrates(efforge(dir, "add", "realtime", "--no-install"))).toBe(false)
  },
)

it("Postgres can't be read: owed when the run writes a migration; Alchemy D1 never", () => {
  const pg = { database: "postgres", orm: "drizzle", infra: "none" } as StackConfig
  expect(migrateOwed(work, pg, ["packages/db/drizzle/20261018161053_auth/migration.sql"])).toBe(
    true,
  )
  expect(migrateOwed(work, pg, ["packages/core/src/Mailer.ts"])).toBe(false)
  const alchemy = { database: "d1", orm: "effect-sql", infra: "alchemy" } as StackConfig
  expect(migrateOwed(work, alchemy, ["packages/db/migrations/0002_auth.sql"])).toBe(false)
})
