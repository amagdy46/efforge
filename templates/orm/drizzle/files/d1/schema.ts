import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

/** Example table. `orgId` is null until you scope notes to an organization. */
export const note = sqliteTable("note", {
  id: text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id"),
  title: text().notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})

export type Note = typeof note.$inferSelect
