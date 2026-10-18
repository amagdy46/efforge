import type { EffectSQLiteD1Database } from "drizzle-orm/effect-d1"
import { Context } from "effect"

/** The app's database, as a Drizzle client whose queries are Effects. */
export class Database extends Context.Service<Database, { readonly db: EffectSQLiteD1Database }>()(
  "@repo/core/Database",
) {}
