import { Database } from "@repo/core/Database"
import * as D1Drizzle from "drizzle-orm/effect-d1"
import { Effect, Layer } from "effect"
import { D1 } from "effect-cf"
import { NotesLive } from "./notes.ts"

/** The `DB` binding from wrangler.jsonc. */
class AppD1 extends D1.Service<AppD1>()("AppD1", { binding: "DB" }) {}

const DatabaseLive = Layer.effect(
  Database,
  Effect.map(D1Drizzle.makeWithDefaults({}), (db) => ({ db })),
).pipe(Layer.provide(AppD1.sqlLayer()))

/**
 * Provides `Database` and `Notes` (notes.ts, on top of it). Needs effect-cf's `WorkerEnvironment`
 * (see apps/web/src/server/cloudflare.ts).
 */
export const DatabaseLayer = NotesLive.pipe(Layer.provideMerge(DatabaseLive))
