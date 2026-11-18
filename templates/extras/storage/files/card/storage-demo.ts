import { deleteUpload, listUploads, MAX_UPLOAD_BYTES, upload } from "@repo/core/storage"
import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"
import { runOutcome } from "./outcome"

/** The uploaded files, each with a signed link that opens it through this Worker. */
export const listFiles = createServerFn({ method: "GET" }).handler(() => runOutcome(listUploads))

const DeleteInput = Schema.Struct({ key: Schema.String.check(Schema.isMaxLength(300)) })

/** Deletes an uploaded file; any other key comes back as `NotAnUpload`. */
export const deleteFile = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(DeleteInput))
  .handler(({ data }) => runOutcome(deleteUpload(data.key)))

// #region card
const UploadInput = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(300)),
  type: Schema.String.check(Schema.isMaxLength(200)),
  // base64 in the request, bytes here; the program refuses over 1 MB
  bytes: Schema.Uint8ArrayFromBase64.check(Schema.isMaxLength(MAX_UPLOAD_BYTES * 4)),
})

/** `FileTooLarge` and `StorageError` come back as data. */
export const uploadFile = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(UploadInput))
  .handler(({ data }) => runOutcome(upload(data.name, data.type, data.bytes)))
// #endregion
