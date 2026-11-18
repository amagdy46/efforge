import { expect, layer } from "@effect/vitest"
import { Clock, Effect, Layer, Ref } from "effect"
import { createNote, InvalidNote, type Note, Notes } from "../src/notes"

/** `Notes` kept in memory: the test layer that stands in for the database. */
const NotesInMemory = Layer.effect(
  Notes,
  Effect.gen(function* () {
    const rows = yield* Ref.make<ReadonlyArray<Note>>([])
    return Notes.of({
      list: Ref.get(rows),
      insert: (title) =>
        Effect.gen(function* () {
          const all = yield* Ref.get(rows)
          const note = {
            id: String(all.length + 1),
            title,
            createdAt: new Date(yield* Clock.currentTimeMillis),
          }
          yield* Ref.set(rows, [note, ...all])
          return note
        }),
    })
  }),
)

layer(NotesInMemory)("createNote", (it) => {
  it.effect("stores the trimmed title", () =>
    Effect.gen(function* () {
      const note = yield* createNote("  Buy milk ")
      expect(note.title).toBe("Buy milk")
      const notes = yield* Notes
      expect(yield* notes.list).toContainEqual(note)
    }),
  )

  it.effect("refuses a blank title with InvalidNote and stores nothing", () =>
    Effect.gen(function* () {
      const notes = yield* Notes
      const before = yield* notes.list
      const error = yield* Effect.flip(createNote("   "))
      expect(error).toBeInstanceOf(InvalidNote)
      expect(yield* notes.list).toEqual(before)
    }),
  )
})
