import { NodeServices } from "@effect/platform-node"
import { PgClient, PgMigrator } from "@effect/sql-pg"
import { Config, Effect, FileSystem, Path, Redacted } from "effect"
import { Migrator, SqlClient } from "effect/sql"

// `pnpm db:migrate`: runs packages/db/migrations/NNNN_name.sql in order against DATABASE_URL
// (default: the docker-compose database). Applied migrations are recorded in `effect_sql_migrations`.
const url = Config.Redacted("DATABASE_URL").pipe(
  Config.withDefault(Redacted.make("postgres://postgres:postgres@localhost:5432/app")),
)

// The pg driver runs one statement per query, so a file is split on `;` (outside `$$` bodies).
// A `;` inside a string literal would be split too: put such statements in their own migration.
const statements = (text: string): string[] => {
  const out: string[] = []
  let current = ""
  for (const part of text.split(";")) {
    current += part
    if ((current.match(/\$\$/g)?.length ?? 0) % 2 === 1) {
      current += ";"
      continue
    }
    if (current.trim() !== "") out.push(current.trim())
    current = ""
  }
  return out
}

const migrationsDir = new URL("../migrations", import.meta.url).pathname

const loader = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const files = (yield* fs.readDirectory(migrationsDir)).filter((f) => f.endsWith(".sql")).sort()
  const entries: Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>> = {}
  for (const file of files) {
    const text = yield* fs.readFileString(path.join(migrationsDir, file))
    entries[file.replace(/\.sql$/, "")] = Effect.flatMap(SqlClient.SqlClient, (sql) =>
      Effect.forEach(statements(text), (statement) => sql.unsafe(statement), { discard: true }),
    )
  }
  return yield* Migrator.fromRecord(entries)
}).pipe(
  Effect.mapError(
    (cause) =>
      new Migrator.MigrationError({
        kind: "ImportError",
        message: `could not read ${migrationsDir}`,
        cause,
      }),
  ),
)

const program = Effect.gen(function* () {
  const applied = yield* PgMigrator.run({ loader, table: "effect_sql_migrations" })
  console.log(
    applied.length === 0 ? "already up to date" : `applied ${applied.length} migration(s)`,
  )
}).pipe(Effect.provide(PgClient.layerConfig({ url })), Effect.provide(NodeServices.layer))

Effect.runPromise(program).catch((error) => {
  console.error(error)
  process.exit(1)
})
