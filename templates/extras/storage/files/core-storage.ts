import { Context, Effect, type Option, Schema } from "effect"
import { ServerOnly } from "./server-only"

/** The bucket could not be reached; `message` says what failed, `cause` (server only) why. */
export class StorageError extends Schema.TaggedError<
  StorageError,
  { readonly brand: unique symbol }
>()("StorageError", { operation: Schema.String, message: Schema.String, cause: ServerOnly }) {}

export interface StoredObject {
  readonly key: string
  readonly size: number
  readonly contentType: string | undefined
  readonly uploaded: Date
}

export interface StoredFile extends StoredObject {
  /** Streamed from the bucket, not buffered; it can be read once. */
  readonly body: ReadableStream
}

/** The Storage layer could not be built: `setting` is missing or too weak. */
export class StorageConfigError extends Schema.TaggedError<
  StorageConfigError,
  { readonly brand: unique symbol }
>()("StorageConfigError", { setting: Schema.String, message: Schema.String }) {}

export interface PutOptions {
  readonly contentType?: string
}

export interface SignedUrlOptions {
  /** Defaults to one hour. */
  readonly expiresInSeconds?: number
}

/**
 * Object storage. The Cloudflare layer is backed by R2.
 *
 * R2 bindings can't presign URLs (that needs S3 API credentials), so `signedUrl` returns a path on
 * this Worker (`/files/<key>?expires=..&signature=..`) that serves the object while the HMAC
 * signature is valid. `verify` checks one (constant-time, rejects expired and malformed ones).
 *
 * Keys are opaque: generate them on the server (for example `crypto.randomUUID()`), never from
 * raw user input, because anyone holding a signed URL can read exactly that key. The Worker serves
 * files as attachments with `nosniff`, and inline only for raster images.
 */
export class Storage extends Context.Service<
  Storage,
  {
    readonly put: (
      key: string,
      body: string | Uint8Array,
      options?: PutOptions,
    ) => Effect.Effect<StoredObject, StorageError>
    readonly get: (key: string) => Effect.Effect<Option.Option<StoredFile>, StorageError>
    /** The objects whose key starts with `prefix`, at most 1000. */
    readonly list: (prefix: string) => Effect.Effect<ReadonlyArray<StoredObject>, StorageError>
    readonly delete: (key: string) => Effect.Effect<void, StorageError>
    readonly signedUrl: (
      key: string,
      options?: SignedUrlOptions,
    ) => Effect.Effect<string, StorageError>
    readonly verify: (
      key: string,
      expires: string | null,
      signature: string | null,
    ) => Effect.Effect<boolean, StorageError>
  }
>()("@repo/core/Storage") {}

/** Where `upload` puts files; `deleteUpload` deletes nothing outside it. */
export const UPLOADS = "uploads/"

/**
 * Where `upload` puts the files of `owner` (a user id, or one name everyone shares): no owner can
 * list, open or delete another's, since every helper below works under this prefix only.
 */
export const uploadsOf = (owner: string): string => `${UPLOADS}${encodeURIComponent(owner)}/`

/** The largest file `upload` stores, in bytes. */
export const MAX_UPLOAD_BYTES = 1_000_000

/** A key that `upload` did not make, so the uploads list may not delete it. */
export class NotAnUpload extends Schema.TaggedError<
  NotAnUpload,
  { readonly brand: unique symbol }
>()("NotAnUpload", { message: Schema.String }) {}

/** The last part of a key, with anything but letters, digits, `.`, `_` and `-` replaced. */
export const fileName = (key: string): string =>
  (key.split("/").at(-1) ?? "").replaceAll(/[^\w.-]/g, "_").slice(0, 100) || "file"

/** A file is larger than `limit` bytes (`MAX_UPLOAD_BYTES`). */
export class FileTooLarge extends Schema.TaggedError<
  FileTooLarge,
  { readonly brand: unique symbol }
>()("FileTooLarge", {
  message: Schema.String,
  size: Schema.Number,
  limit: Schema.Number,
}) {}

// #region card
/** Stores `owner`'s file under a key made here: never one the client picks. */
export const upload = (
  owner: string,
  name: string,
  contentType: string,
  bytes: Uint8Array,
): Effect.Effect<StoredObject, FileTooLarge | StorageError, Storage> =>
  Effect.gen(function* () {
    if (bytes.byteLength > MAX_UPLOAD_BYTES)
      return yield* new FileTooLarge({
        message: `Files are at most ${MAX_UPLOAD_BYTES / 1_000_000} MB here.`,
        size: bytes.byteLength,
        limit: MAX_UPLOAD_BYTES,
      })
    const storage = yield* Storage
    const key = `${uploadsOf(owner)}${crypto.randomUUID()}/${fileName(name)}`
    return yield* storage.put(key, bytes, { contentType })
  })
// #endregion

export interface Upload extends StoredObject {
  readonly name: string
  /** A signed `/files/...` link, valid for ten minutes */
  readonly url: string
}

/** `owner`'s uploaded files, newest first, each with a link that opens it through this Worker. */
export const listUploads = (
  owner: string,
): Effect.Effect<ReadonlyArray<Upload>, StorageError, Storage> =>
  Effect.gen(function* () {
    const storage = yield* Storage
    const objects = yield* storage.list(uploadsOf(owner))
    const newest = objects.toSorted((a, b) => b.uploaded.getTime() - a.uploaded.getTime())
    return yield* Effect.forEach(newest, (object): Effect.Effect<Upload, StorageError> =>
      storage
        .signedUrl(object.key, { expiresInSeconds: 600 })
        .pipe(Effect.map((url) => ({ ...object, name: fileName(object.key), url }))),
    )
  })

/** Deletes a file `upload` stored for `owner`; any other key fails with `NotAnUpload`. */
export const deleteUpload = (
  owner: string,
  key: string,
): Effect.Effect<void, NotAnUpload | StorageError, Storage> =>
  Effect.gen(function* () {
    if (!key.startsWith(uploadsOf(owner)))
      return yield* new NotAnUpload({ message: "Only your own uploads can be deleted here." })
    const storage = yield* Storage
    return yield* storage.delete(key)
  })
