import { Storage, StorageConfigError, StorageError } from "@repo/core"
import { MIN_SECRET_LENGTH, signPayload, verifyPayload } from "@repo/core/storage-security"
import { Config, ConfigProvider, Effect, Layer, Option, Redacted } from "effect"
import { R2, WorkerConfig } from "effect-cf"
import { WorkerEnvLive } from "./cloudflare"

class StorageBucket extends R2.Tag<StorageBucket>()("StorageBucket") {}

const SECRET = "STORAGE_SIGNING_SECRET"

/** The signing secret, read once when the layer is built. Fails with a clear message if unusable. */
const loadSecret = (provider: ConfigProvider.ConfigProvider) =>
  Config.Redacted(SECRET).pipe(
    Effect.provideService(ConfigProvider.ConfigProvider, provider),
    Effect.mapError(
      () =>
        new StorageConfigError({
          setting: SECRET,
          message: `${SECRET} is not set. Set it to a random string of at least 32 characters (wrangler secret put ${SECRET}, or .dev.vars locally).`,
        }),
    ),
    Effect.map(Redacted.value),
    Effect.filterOrFail(
      (secret) => secret.length >= MIN_SECRET_LENGTH,
      () =>
        new StorageConfigError({
          setting: SECRET,
          message: `${SECRET} is too short: use at least ${MIN_SECRET_LENGTH} characters.`,
        }),
    ),
  )

const failed: Record<string, string> = {
  put: "Could not store the file.",
  get: "Could not read the file.",
  list: "Could not list the bucket.",
  delete: "Could not delete the file.",
  signedUrl: "Could not sign the link.",
  verify: "Could not check the link.",
}
const fail = (operation: string) => (cause: unknown) =>
  new StorageError({ operation, message: failed[operation] ?? "Storage failed.", cause })

const make = Effect.gen(function* () {
  const bucket = yield* StorageBucket
  const secret = yield* loadSecret(yield* WorkerConfig.provider)
  return Storage.of({
    put: (key, body, options) =>
      bucket
        .put(
          key,
          body,
          options?.contentType === undefined || options.contentType === ""
            ? {}
            : { httpMetadata: { contentType: options.contentType } },
        )
        .pipe(
          Effect.map((o) => ({
            key: o.key,
            size: o.size,
            contentType: o.httpMetadata?.contentType,
            uploaded: o.uploaded,
          })),
          Effect.mapError(fail("put")),
        ),
    get: (key) =>
      Effect.gen(function* () {
        const found = yield* bucket.get(key)
        if (Option.isNone(found)) return Option.none()
        const object = found.value
        return Option.some({
          key,
          size: object.size,
          contentType: object.httpMetadata?.contentType,
          uploaded: object.uploaded,
          body: object.body,
        })
      }).pipe(Effect.mapError(fail("get"))),
    list: (prefix) =>
      bucket.list({ prefix, include: ["httpMetadata"] }).pipe(
        Effect.map((page) =>
          page.objects.map((o) => ({
            key: o.key,
            size: o.size,
            contentType: o.httpMetadata?.contentType,
            uploaded: o.uploaded,
          })),
        ),
        Effect.mapError(fail("list")),
      ),
    delete: (key) => bucket.delete(key).pipe(Effect.mapError(fail("delete"))),
    signedUrl: (key, options) =>
      Effect.gen(function* () {
        const expires = String(Math.floor(Date.now() / 1000) + (options?.expiresInSeconds ?? 3600))
        const signature = yield* Effect.promise(() => signPayload(secret, key, expires))
        return `/files/${encodeURIComponent(key)}?expires=${expires}&signature=${signature}`
      }).pipe(Effect.mapError(fail("signedUrl"))),
    verify: (key, expires, signature) =>
      Effect.gen(function* () {
        if (expires === null || signature === null) return false
        return yield* Effect.promise(() => verifyPayload(secret, key, expires, signature))
      }).pipe(Effect.mapError(fail("verify"))),
  })
})

// #region card
/** `Storage` on the `STORAGE` R2 bucket; it signs links with a secret. */
export const StorageLive = Layer.effect(Storage, make).pipe(
  Layer.provide(StorageBucket.layer({ binding: "STORAGE" })),
  Layer.provide(WorkerEnvLive),
)
// #endregion
