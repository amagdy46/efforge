import { Context } from "effect"
import type { SqlClient } from "effect/sql"

/** The app's database, as an Effect SQL client: `sql\`SELECT ...\``. */
export class Database extends Context.Service<Database, { readonly sql: SqlClient.SqlClient }>()(
  "@repo/core/Database",
) {}
