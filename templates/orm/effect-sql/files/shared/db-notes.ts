import { Database } from "@repo/core/Database"
import { Notes, notesUnavailable } from "@repo/core/notes"
import { Effect, Layer } from "effect"
import type { Note } from "./schema.ts"

type Row = Pick<Note, "id" | "title" | "createdAt">

const toNote = (row: Row) => ({ id: row.id, title: row.title, createdAt: new Date(row.createdAt) })

// #region card
/** `Notes` on the `note` table: each query is an SQL template and an Effect. */
export const NotesLive = Layer.effect(
  Notes,
  Effect.gen(function* () {
    const { sql } = yield* Database
    return Notes.of({
      list: sql<Row>`
        SELECT id, title, created_at AS "createdAt"
        FROM note ORDER BY created_at DESC
      `.pipe(
        Effect.map((rows) => rows.map(toNote)),
        Effect.mapError(notesUnavailable),
      ),
      insert: (title) =>
        sql<Row>`
          INSERT INTO note (title) VALUES (${title})
          RETURNING id, title, created_at AS "createdAt"
        `.pipe(
          Effect.mapError(notesUnavailable),
          Effect.flatMap(([row]) =>
            row === undefined
              ? Effect.fail(notesUnavailable("the insert returned no row"))
              : Effect.succeed(toNote(row)),
          ),
        ),
    })
  }),
)
// #endregion
