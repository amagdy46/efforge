import { Database } from "@repo/core/Database"
import { LlmError } from "@repo/core/llm"
import { type LlmCredentialRow, LlmCredentialStore } from "@repo/core/llm-store"
import { Effect, Layer, Option } from "effect"

const fail = (operation: string) => (cause: unknown) => new LlmError({ operation, cause })

/** `LlmCredentialStore` over the `llm_credential` table, through the Database service. */
export const LlmCredentialStoreLive = Layer.effect(
  LlmCredentialStore,
  Effect.gen(function* () {
    const { sql } = yield* Database
    return LlmCredentialStore.of({
      find: (orgId) =>
        sql<LlmCredentialRow>`
          SELECT org_id AS "orgId", provider, model, encrypted_key AS "encryptedKey", base_url AS "baseUrl"
          FROM llm_credential
          WHERE org_id = ${orgId}
        `.pipe(
          Effect.map((rows) => Option.fromNullishOr(rows[0])),
          Effect.mapError(fail("find credential")),
        ),
      upsert: (row) =>
        sql`
          INSERT INTO llm_credential (org_id, provider, model, encrypted_key, base_url, updated_at)
          VALUES (${row.orgId}, ${row.provider}, ${row.model}, ${row.encryptedKey}, ${row.baseUrl}, ${new Date()})
          ON CONFLICT (org_id) DO UPDATE SET
            provider = excluded.provider,
            model = excluded.model,
            encrypted_key = excluded.encrypted_key,
            base_url = excluded.base_url,
            updated_at = excluded.updated_at
        `.pipe(Effect.asVoid, Effect.mapError(fail("save credential"))),
      remove: (orgId) =>
        sql`DELETE FROM llm_credential WHERE org_id = ${orgId}`.pipe(
          Effect.asVoid,
          Effect.mapError(fail("clear credential")),
        ),
    })
  }),
)
