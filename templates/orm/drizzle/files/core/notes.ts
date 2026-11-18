import { Context, Data, Effect } from "effect"

export interface Note {
  readonly id: string
  readonly title: string
  readonly createdAt: Date
}

/** The title was blank or longer than 200 characters. */
export class InvalidNote extends Data.TaggedError("InvalidNote")<{ readonly message: string }> {}

/** The notes could not be read or written; `message` says what to do about it. */
export class NotesUnavailable extends Data.TaggedError("NotesUnavailable")<{
  readonly reason: "not-migrated" | "unreachable" | "query-failed"
  readonly message: string
}> {}

/** Where notes are kept. packages/db implements it on the `Database` service; tests swap in a fake. */
export class Notes extends Context.Service<
  Notes,
  {
    /** Newest first */
    readonly list: Effect.Effect<ReadonlyArray<Note>, NotesUnavailable>
    readonly insert: (title: string) => Effect.Effect<Note, NotesUnavailable>
  }
>()("@repo/core/Notes") {}

// #region card
/** Checks the title, then stores the note through `Notes`. */
export const createNote = (
  input: string,
): Effect.Effect<Note, InvalidNote | NotesUnavailable, Notes> =>
  Effect.gen(function* () {
    const title = input.trim()
    if (title.length === 0 || title.length > 200)
      return yield* new InvalidNote({ message: "A note needs a title of 1 to 200 characters." })
    const notes = yield* Notes
    return yield* notes.insert(title)
  })
// #endregion

const messages = (cause: unknown): string[] =>
  typeof cause === "object" && cause !== null
    ? [
        ...("message" in cause ? [String(cause.message)] : []),
        ...("cause" in cause ? messages(cause.cause) : []),
      ]
    : [String(cause)]

/** Turns a database failure into `NotesUnavailable`, with the command that fixes the usual ones. */
export const notesUnavailable = (cause: unknown): NotesUnavailable => {
  const text = messages(cause).join(": ")
  if (/no such table|does not exist/i.test(text))
    return new NotesUnavailable({
      reason: "not-migrated",
      message: "The note table does not exist yet. Run pnpm db:migrate, then reload.",
    })
  if (/ECONNREFUSED|ENOTFOUND|connect|timed? ?out/i.test(text))
    return new NotesUnavailable({
      reason: "unreachable",
      message:
        "The database is not reachable. For Postgres, start it with docker compose up -d --wait.",
    })
  return new NotesUnavailable({ reason: "query-failed", message: text })
}
