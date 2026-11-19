import { deleteUpload, listUploads, upload } from "@repo/core/storage"
import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { runOutcome } from "./outcome"
import { currentOwner } from "./owner"

/** Your uploaded files, each with a signed link that opens it through this Worker. */
export const listFiles = createServerFn({ method: "GET" }).handler(() =>
  runOutcome(currentOwner.pipe(Effect.flatMap(listUploads))),
)

const DeleteInput = Schema.Struct({ key: Schema.String.check(Schema.isMaxLength(300)) })

/** Deletes one of your uploads; any other key comes back as `NotAnUpload`. */
export const deleteFile = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(DeleteInput))
  .handler(({ data }) =>
    runOutcome(currentOwner.pipe(Effect.flatMap((owner) => deleteUpload(owner, data.key)))),
  )

// #region card
const UploadInput = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(300)),
  type: Schema.String.check(Schema.isMaxLength(200)),
  // base64 in the request, bytes here; up to 4 MB reaches the program,
  // which refuses over 1 MB with FileTooLarge
  bytes: Schema.Uint8ArrayFromBase64.check(Schema.isMaxLength(4_000_000)),
})

/** Stored under the caller's own prefix; `FileTooLarge` comes back as data. */
export const uploadFile = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(UploadInput))
  .handler(({ data }) =>
    runOutcome(
      Effect.gen(function* () {
        const owner = yield* currentOwner
        return yield* upload(owner, data.name, data.type, data.bytes)
      }),
    ),
  )
// #endregion
