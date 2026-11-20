import { Database } from "@repo/core/Database"
import type { Note } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"
import { runtime } from "./runtime"

export const listNotes = createServerFn({ method: "GET" }).handler(() =>
  runtime.runPromise(
    Effect.gen(function* () {
      const { sql } = yield* Database
      return yield* sql<Note>`
        SELECT id, org_id AS "orgId", title, created_at AS "createdAt"
        FROM note
        ORDER BY created_at DESC
      `
    }),
  ),
)
