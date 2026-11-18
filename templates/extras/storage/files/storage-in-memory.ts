import { Clock, Effect, Layer, Option, Ref } from "effect"
import { Storage, type StoredObject } from "../src/storage"

interface Entry extends StoredObject {
  readonly bytes: Uint8Array
}

const described = ({ key, size, contentType, uploaded }: Entry): StoredObject => ({
  key,
  size,
  contentType,
  uploaded,
})

const encode = (body: string | Uint8Array) =>
  typeof body === "string" ? new TextEncoder().encode(body) : body

/**
 * `Storage` without R2, for tests: objects live in a map, and signed links are
 * `/files/<key>?test` and always verify. Each `layer(StorageInMemory)` block starts empty.
 */
export const StorageInMemory = Layer.effect(
  Storage,
  Effect.gen(function* () {
    const objects = yield* Ref.make(new Map<string, Entry>())
    return Storage.of({
      put: (key, body, options) =>
        Effect.gen(function* () {
          const bytes = encode(body)
          const entry: Entry = {
            key,
            size: bytes.byteLength,
            contentType: options?.contentType,
            uploaded: new Date(yield* Clock.currentTimeMillis),
            bytes,
          }
          yield* Ref.update(objects, (all) => new Map(all).set(key, entry))
          return described(entry)
        }),
      get: (key) =>
        Ref.get(objects).pipe(
          Effect.map((all) =>
            Option.fromNullishOr(all.get(key)).pipe(
              Option.map((entry) =>
                Object.assign(described(entry), {
                  body: new Blob([new Uint8Array(entry.bytes)]).stream(),
                }),
              ),
            ),
          ),
        ),
      list: (prefix) =>
        Ref.get(objects).pipe(
          Effect.map((all) =>
            [...all.values()].filter((entry) => entry.key.startsWith(prefix)).map(described),
          ),
        ),
      delete: (key) =>
        Ref.update(objects, (all) => {
          const next = new Map(all)
          next.delete(key)
          return next
        }),
      signedUrl: (key) => Effect.succeed(`/files/${encodeURIComponent(key)}?test`),
      verify: () => Effect.succeed(true),
    })
  }),
)
