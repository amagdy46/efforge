import { Storage, StorageError } from "@repo/core"
import { Config, ConfigProvider, Effect, Layer, Option, Redacted } from "effect"
import { R2, WorkerConfig } from "effect-cf"
import { CloudflareEnv } from "./cloudflare"

class StorageBucket extends R2.Tag<StorageBucket>()("StorageBucket") {}

const encoder = new TextEncoder()
const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("")

/** HMAC-SHA256 over `<key>\n<expires>`, keyed by the STORAGE_SIGNING_SECRET secret. */
const sign = (provider: ConfigProvider.ConfigProvider, key: string, expires: string) =>
  Effect.gen(function* () {
    const secret = yield* Config.Redacted("STORAGE_SIGNING_SECRET")
    const cryptoKey = yield* Effect.promise(() =>
      crypto.subtle.importKey(
        "raw",
        encoder.encode(Redacted.value(secret)),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      ),
    )
    const mac = yield* Effect.promise(() =>
      crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(`${key}\n${expires}`)),
    )
    return hex(mac)
  }).pipe(Effect.provide(ConfigProvider.layer(provider)))

const fail = (operation: string) => (cause: unknown) => new StorageError({ operation, cause })

const make = Effect.gen(function* () {
  const bucket = yield* StorageBucket
  const provider = yield* WorkerConfig.provider
  return Storage.of({
    put: (key, body, options) =>
      bucket
        .put(
          key,
          body,
          options?.contentType === undefined
            ? {}
            : { httpMetadata: { contentType: options.contentType } },
        )
        .pipe(
          Effect.map((o) => ({
            key: o.key,
            size: o.size,
            contentType: o.httpMetadata?.contentType,
          })),
          Effect.mapError(fail("put")),
        ),
    get: (key) =>
      Effect.gen(function* () {
        const found = yield* bucket.get(key)
        if (Option.isNone(found)) return Option.none()
        const object = found.value
        const body = yield* object.arrayBuffer
        return Option.some({
          key,
          size: object.size,
          contentType: object.httpMetadata?.contentType,
          body,
        })
      }).pipe(Effect.mapError(fail("get"))),
    delete: (key) => bucket.delete(key).pipe(Effect.mapError(fail("delete"))),
    signedUrl: (key, options) =>
      Effect.gen(function* () {
        const expires = String(Math.floor(Date.now() / 1000) + (options?.expiresInSeconds ?? 3600))
        const signature = yield* sign(provider, key, expires)
        return `/files/${encodeURIComponent(key)}?expires=${expires}&signature=${signature}`
      }).pipe(Effect.mapError(fail("signedUrl"))),
    verify: (key, expires, signature) =>
      Effect.gen(function* () {
        if (expires === null || signature === null) return false
        if (Number(expires) * 1000 < Date.now()) return false
        return (yield* sign(provider, key, expires)) === signature
      }).pipe(Effect.mapError(fail("verify"))),
  })
})

/** `Storage` on the `STORAGE` R2 bucket binding. */
export const StorageLive = Layer.effect(Storage, make).pipe(
  Layer.provide(StorageBucket.layer({ binding: "STORAGE" })),
  Layer.provide(CloudflareEnv),
)
