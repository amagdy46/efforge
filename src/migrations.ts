import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { StackConfig } from "./stack.ts"

// Whether `pnpm db:migrate` is still owed, read from the project as it is, not remembered from a
// run: `doctor`'s `migrations` check and the next steps of `create`, `add`, `upgrade` and their
// `Interrupted` documents all ask here.

/** Where wrangler keeps the local D1 databases (`pnpm dev`, `pnpm db:migrate`). */
export const D1_STATE = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject"

/** The names in the `d1_migrations` table of each local D1 database file; undefined if unreadable. */
export const appliedD1 = (files: ReadonlyArray<string>): string[] | undefined => {
  // node:sqlite prints an ExperimentalWarning on some Node versions; --json allows no stderr
  const original = Object.getOwnPropertyDescriptor(process, "emitWarning")
  try {
    Object.defineProperty(process, "emitWarning", {
      value: () => {},
      configurable: true,
      writable: true,
    })
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite")
    const names: string[] = []
    for (const file of files) {
      const db = new DatabaseSync(file, { readOnly: true })
      try {
        const table = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'")
          .get()
        if (table !== undefined)
          for (const row of db.prepare("SELECT name FROM d1_migrations").all())
            names.push(String((row as { name: unknown }).name))
      } finally {
        db.close()
      }
    }
    return names
  } catch {
    return undefined
  } finally {
    if (original !== undefined) Object.defineProperty(process, "emitWarning", original)
  }
}

export type LocalMigrations =
  | { readonly known: false; readonly why: string }
  | {
      readonly known: true
      readonly expected: ReadonlyArray<string>
      readonly applied: ReadonlyArray<string>
      readonly pending: ReadonlyArray<string>
    }

/** The project's migrations against its local database, or why that can't be known. */
export const localMigrations = (
  dir: string,
  stack: StackConfig,
  read: (files: ReadonlyArray<string>) => string[] | undefined = appliedD1,
): LocalMigrations => {
  const unknown = (why: string) => ({ known: false as const, why })
  if (stack.database === "none") return unknown("This stack has no database.")
  if (stack.database === "postgres")
    return unknown(
      "Which Postgres migrations are applied can't be read without connecting to the database.",
    )
  if (stack.infra === "alchemy")
    return unknown("Alchemy applies D1 migrations when it runs (pnpm dev).")
  const entries = (rel: string) => {
    try {
      return readdirSync(join(dir, rel), { withFileTypes: true })
    } catch {
      return undefined
    }
  }
  // drizzle-kit writes one folder per migration; `pnpm db:migrate` numbers them like this
  const drizzle = entries("packages/db/drizzle")
  const expected =
    stack.orm === "drizzle" && drizzle !== undefined
      ? drizzle
          .filter(
            (e) =>
              e.isDirectory() &&
              existsSync(join(dir, "packages/db/drizzle", e.name, "migration.sql")),
          )
          .map((e) => e.name)
          .toSorted()
          .map((d, i) => `${String(i + 1).padStart(4, "0")}_${d.replace(/^\d+_/, "")}.sql`)
      : (entries("packages/db/migrations") ?? [])
          .filter((e) => e.isFile() && e.name.endsWith(".sql"))
          .map((e) => e.name)
          .toSorted()
  if (expected.length === 0) return unknown("There are no migration files.")
  const files = (entries(D1_STATE) ?? [])
    .filter((e) => e.isFile() && e.name.endsWith(".sqlite") && e.name !== "metadata.sqlite")
    .map((e) => join(dir, D1_STATE, e.name))
  const applied = files.length === 0 ? [] : read(files)
  if (applied === undefined) return unknown("The local D1 database couldn't be read.")
  return { known: true, expected, applied, pending: expected.filter((m) => !applied.includes(m)) }
}

/** A migration file a run writes (drizzle-kit's folder or a plain .sql). */
export const isMigration = (file: string) =>
  /^packages\/db\/(?:drizzle\/[^/]+\/migration\.sql|migrations\/[^/]+\.sql)$/.test(file)

/**
 * True when `pnpm db:migrate` is owed in `dir`: the local D1 database lacks a migration, or, where
 * that can't be read (Postgres, nothing written yet), `files` (what the run wrote or would write)
 * has one. Never with Alchemy, which applies D1 migrations itself, or without a database.
 */
export const migrateOwed = (
  dir: string,
  stack: StackConfig,
  files: ReadonlyArray<string>,
): boolean => {
  if (stack.database === "none") return false
  if (stack.database === "d1" && stack.infra === "alchemy") return false
  const local = localMigrations(dir, stack)
  return (local.known && local.pending.length > 0) || files.some(isMigration)
}

/** The project's migration files on disk, relative to `dir`. */
export const migrationFiles = (dir: string): string[] => {
  const list = (rel: string) => {
    try {
      return readdirSync(join(dir, rel), { recursive: true, encoding: "utf8" }).map(
        (f) => `${rel}/${f}`,
      )
    } catch {
      return []
    }
  }
  return [...list("packages/db/drizzle"), ...list("packages/db/migrations")].filter(isMigration)
}

/** `steps` without `pnpm db:migrate` when it isn't owed. */
export const migrateIfOwed = <S extends { readonly command: string }>(
  steps: ReadonlyArray<S>,
  owed: boolean,
): S[] => steps.filter((s) => owed || s.command !== "pnpm db:migrate")
