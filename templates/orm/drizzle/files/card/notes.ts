import { createNote, InvalidNote, Notes, NotesUnavailable } from "@repo/core/notes"
import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"
import { runOutcome } from "./outcome"

// #region card
const newestFirst = Notes.use((notes) => notes.list)

/** What `listNotes` can fail with: a database that is not set up. */
export const ListNotesErrors = [NotesUnavailable] as const

/** Newest first. */
export const listNotes = createServerFn({ method: "GET" }).handler(() =>
  runOutcome(newestFirst, ...ListNotesErrors),
)

const AddNoteInput = Schema.Struct({
  title: Schema.String.check(Schema.isMaxLength(1000)),
})

/** What `addNote` can fail with; they reach the browser as these classes. */
export const AddNoteErrors = [InvalidNote, NotesUnavailable] as const

export const addNote = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(AddNoteInput))
  .handler(({ data }) => runOutcome(createNote(data.title), ...AddNoteErrors))
// #endregion
