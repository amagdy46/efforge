import { Database } from "@repo/core/Database"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { D1 } from "effect-cf"

/** The `DB` binding from wrangler.jsonc. */
class AppD1 extends D1.Service<AppD1>()("AppD1", { binding: "DB" }) {}

/** Provides `Database`. Needs effect-cf's `WorkerEnvironment` (see apps/web/src/server/cloudflare.ts). */
export const DatabaseLayer = Layer.effect(
  Database,
  Effect.map(SqlClient.SqlClient, (sql) => ({ sql })),
).pipe(Layer.provide(AppD1.sqlLayer()))
