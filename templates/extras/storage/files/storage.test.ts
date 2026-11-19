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
      const stored = yield* upload("../notes <1>.txt", "text/plain", text("hello"))
      expect(stored.key).toMatch(/^uploads\/[0-9a-f-]{36}\/notes__1_\.txt$/)
      expect(stored.size).toBe(5)
      const files = yield* listUploads
      expect(files).toContainEqual(
        expect.objectContaining({ key: stored.key, name: "notes__1_.txt", size: 5 }),
      )
      expect(files.find((f) => f.key === stored.key)?.url).toContain("/files/")
    }),
  )

  it.effect("refuses a file over 1 MB with FileTooLarge and stores nothing", () =>
    Effect.gen(function* () {
      const before = yield* listUploads
      const error = yield* Effect.flip(upload("big.bin", "", new Uint8Array(MAX_UPLOAD_BYTES + 1)))
      expect(error).toBeInstanceOf(FileTooLarge)
      expect(yield* listUploads).toEqual(before)
    }),
  )

  it.effect("deletes an upload, and refuses a key it did not make with NotAnUpload", () =>
    Effect.gen(function* () {
      const storage = yield* Storage
      yield* storage.put("private/report.pdf", text("secret"))
      const stored = yield* upload("a.txt", "text/plain", text("a"))
      yield* deleteUpload(stored.key)
      expect((yield* listUploads).map((f) => f.key)).not.toContain(stored.key)
      const error = yield* Effect.flip(deleteUpload("private/report.pdf"))
      expect(error).toBeInstanceOf(NotAnUpload)
      expect(yield* storage.list("private/")).toHaveLength(1)
    }),
  )
})
