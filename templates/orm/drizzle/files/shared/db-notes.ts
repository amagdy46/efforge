import { Database } from "@repo/core/Database"
import { Notes, notesUnavailable } from "@repo/core/notes"
import { desc } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { note } from "./schema.ts"

// #region card
/** `Notes` on the `note` table, with Drizzle. Each query is an Effect. */
export const NotesLive = Layer.effect(
  Notes,
  Effect.gen(function* () {
    const { db } = yield* Database
    return Notes.of({
      list: db
        .select({ id: note.id, title: note.title, createdAt: note.createdAt })
        .from(note)
        .orderBy(desc(note.createdAt))
        .pipe(Effect.mapError(notesUnavailable)),
      insert: (title) =>
        db
          .insert(note)
          .values({ title })
          .returning({
            id: note.id,
            title: note.title,
            createdAt: note.createdAt,
          })
          .pipe(
            Effect.mapError(notesUnavailable),
            Effect.flatMap(([row]) =>
              row === undefined
                ? Effect.fail(notesUnavailable("the insert returned no row"))
                : Effect.succeed(row),
            ),
          ),
    })
  }),
)
// #endregion
