import { expect, layer } from "@effect/vitest"
import { Effect } from "effect"
import {
  deleteUpload,
  FileTooLarge,
  listUploads,
  MAX_UPLOAD_BYTES,
  NotAnUpload,
  Storage,
  upload,
} from "../src/storage"
import { StorageInMemory } from "./storage-in-memory"

const text = (value: string) => new TextEncoder().encode(value)

layer(StorageInMemory)("upload", (it) => {
  it.effect("stores a file under a key the server makes, and lists it with a link", () =>
    Effect.gen(function* () {
      const stored = yield* upload("ada", "../notes <1>.txt", "text/plain", text("hello"))
      expect(stored.key).toMatch(/^uploads\/ada\/[0-9a-f-]{36}\/notes__1_\.txt$/)
      expect(stored.size).toBe(5)
      const files = yield* listUploads("ada")
      expect(files).toContainEqual(
        expect.objectContaining({ key: stored.key, name: "notes__1_.txt", size: 5 }),
      )
      expect(files.find((f) => f.key === stored.key)?.url).toContain("/files/")
    }),
  )

  it.effect("refuses a file over 1 MB with FileTooLarge and stores nothing", () =>
    Effect.gen(function* () {
      const before = yield* listUploads("ada")
      const error = yield* Effect.flip(
        upload("ada", "big.bin", "", new Uint8Array(MAX_UPLOAD_BYTES + 1)),
      )
      expect(error).toBeInstanceOf(FileTooLarge)
      expect(yield* listUploads("ada")).toEqual(before)
    }),
  )

  it.effect("deletes an upload, and refuses a key it did not make with NotAnUpload", () =>
    Effect.gen(function* () {
      const storage = yield* Storage
      yield* storage.put("private/report.pdf", text("secret"))
      const stored = yield* upload("ada", "a.txt", "text/plain", text("a"))
      yield* deleteUpload("ada", stored.key)
      expect((yield* listUploads("ada")).map((f) => f.key)).not.toContain(stored.key)
      const error = yield* Effect.flip(deleteUpload("ada", "private/report.pdf"))
      expect(error).toBeInstanceOf(NotAnUpload)
      expect(yield* storage.list("private/")).toHaveLength(1)
    }),
  )

  it.effect("keeps each owner's uploads apart: another owner cannot list or delete them", () =>
    Effect.gen(function* () {
      const ada = yield* upload("ada", "ada.txt", "text/plain", text("a"))
      const rev = yield* upload("rev", "rev.txt", "text/plain", text("r"))
      expect((yield* listUploads("rev")).map((f) => f.key)).toEqual([rev.key])
      // a prefix of another owner's name is not that owner
      expect(yield* listUploads("ad")).toEqual([])
      const error = yield* Effect.flip(deleteUpload("rev", ada.key))
      expect(error).toBeInstanceOf(NotAnUpload)
      expect((yield* listUploads("ada")).map((f) => f.key)).toContain(ada.key)
    }),
  )
})
