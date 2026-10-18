import { Database } from "@repo/core/Database"
import * as D1Drizzle from "drizzle-orm/effect-d1"
import { Effect, Layer } from "effect"
import { D1 } from "effect-cf"

/** The `DB` binding from wrangler.jsonc. */
class AppD1 extends D1.Service<AppD1>()("AppD1", { binding: "DB" }) {}

/** Provides `Database`. Needs effect-cf's `WorkerEnvironment` (see apps/web/src/server/cloudflare.ts). */
export const DatabaseLayer = Layer.effect(
  Database,
  Effect.map(D1Drizzle.makeWithDefaults({}), (db) => ({ db })),
).pipe(Layer.provide(AppD1.sqlLayer()))
