import { Context, Data, type Effect, type Option } from "effect"

export class StorageError extends Data.TaggedError("StorageError")<{
  readonly operation: string
  readonly cause: unknown
}> {}

export interface StoredObject {
  readonly key: string
  readonly size: number
  readonly contentType: string | undefined
}

export interface StoredFile extends StoredObject {
  readonly body: ArrayBuffer
}

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
 * signature is valid. `verify` checks one.
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
