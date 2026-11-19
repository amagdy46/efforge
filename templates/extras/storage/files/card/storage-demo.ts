import {
  deleteUpload,
  FileTooLarge,
  listUploads,
  NotAnUpload,
  StorageError,
  upload,
} from "@repo/core/storage"
import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { runOutcome } from "./outcome"
import { currentOwner } from "./owner"

/** What `listFiles` can fail with. */
export const ListFilesErrors = [StorageError] as const

/** Your uploaded files, each with a signed link that opens it through this Worker. */
export const listFiles = createServerFn({ method: "GET" }).handler(() =>
  runOutcome(currentOwner.pipe(Effect.flatMap(listUploads)), ...ListFilesErrors),
)

const DeleteInput = Schema.Struct({ key: Schema.String.check(Schema.isMaxLength(300)) })

/** What `deleteFile` can fail with: any key but one of yours is `NotAnUpload`. */
export const DeleteFileErrors = [NotAnUpload, StorageError] as const

/** Deletes one of your uploads. */
export const deleteFile = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(DeleteInput))
  .handler(({ data }) =>
    runOutcome(
      currentOwner.pipe(Effect.flatMap((owner) => deleteUpload(owner, data.key))),
      ...DeleteFileErrors,
    ),
  )

// #region card
const UploadInput = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(300)),
  type: Schema.String.check(Schema.isMaxLength(200)),
  // base64 in the request, bytes here; up to 4 MB reaches the program,
  // which refuses over 1 MB with FileTooLarge
  bytes: Schema.Uint8ArrayFromBase64.check(Schema.isMaxLength(4_000_000)),
})

/** What `uploadFile` can fail with; each arrives as itself. */
export const UploadFileErrors = [FileTooLarge, StorageError] as const

/** Stored under the caller's own prefix. */
export const uploadFile = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(UploadInput))
  .handler(({ data }) =>
    runOutcome(
      Effect.gen(function* () {
        const owner = yield* currentOwner
        return yield* upload(owner, data.name, data.type, data.bytes)
      }),
      ...UploadFileErrors,
    ),
  )
// #endregion
