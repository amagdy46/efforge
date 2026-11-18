import { createNote, Notes } from "@repo/core/notes"
import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"
import { runOutcome } from "./outcome"

// #region card
/** The notes, newest first; a database that is not set up comes back as `NotesUnavailable`. */
export const listNotes = createServerFn({ method: "GET" }).handler(() =>
  runOutcome(Notes.use((notes) => notes.list)),
)

const AddNoteInput = Schema.Struct({ title: Schema.String.check(Schema.isMaxLength(1000)) })

/** Runs `createNote` from @repo/core: `InvalidNote` and `NotesUnavailable` come back as data. */
export const addNote = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(AddNoteInput))
  .handler(({ data }) => runOutcome(createNote(data.title)))
// #endregion
