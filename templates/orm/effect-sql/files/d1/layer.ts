import { Database } from "@repo/core/Database"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { D1 } from "effect-cf"
import { NotesLive } from "./notes.ts"

/** The `DB` binding from wrangler.jsonc. */
class AppD1 extends D1.Service<AppD1>()("AppD1", { binding: "DB" }) {}

const DatabaseLive = Layer.effect(
  Database,
  Effect.map(SqlClient.SqlClient, (sql) => ({ sql })),
).pipe(Layer.provide(AppD1.sqlLayer()))

/**
 * Provides `Database` and `Notes` (notes.ts, on top of it). Needs effect-cf's `WorkerEnvironment`
 * (see apps/web/src/server/cloudflare.ts).
 */
export const DatabaseLayer = NotesLive.pipe(Layer.provideMerge(DatabaseLive))
