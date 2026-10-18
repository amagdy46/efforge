import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { organization } from "./auth-schema.ts"

/** One AI provider key per organization, AES-GCM encrypted (see packages/core/src/llm-crypto.ts). */
export const llmCredential = sqliteTable("llm_credential", {
  orgId: text("org_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  provider: text().notNull(),
  model: text().notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  baseUrl: text("base_url"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})
