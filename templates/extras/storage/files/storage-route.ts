import { Storage } from "@repo/core"
import { Effect, Option } from "effect"
import type { WorkerRoute } from "./routes"
import { runtime } from "./runtime"

const prefix = "/files/"

/** Serves `/files/<key>?expires=..&signature=..` (see `Storage.signedUrl`) straight from the bucket. */
export const storageRoute: WorkerRoute = async (request) => {
  const url = new URL(request.url)
  if (request.method !== "GET" || !url.pathname.startsWith(prefix)) return undefined
  const key = decodeURIComponent(url.pathname.slice(prefix.length))
  return runtime.runPromise(
    Effect.gen(function* () {
      const storage = yield* Storage
      const valid = yield* storage.verify(
        key,
        url.searchParams.get("expires"),
        url.searchParams.get("signature"),
      )
      if (!valid) return new Response("Forbidden", { status: 403 })
      const file = yield* storage.get(key)
      if (Option.isNone(file)) return new Response("Not found", { status: 404 })
      return new Response(file.value.body, {
        headers: {
          "content-type": file.value.contentType ?? "application/octet-stream",
          "cache-control": "private, max-age=0",
        },
      })
    }).pipe(Effect.orElseSucceed(() => new Response("Storage error", { status: 502 }))),
  )
}
