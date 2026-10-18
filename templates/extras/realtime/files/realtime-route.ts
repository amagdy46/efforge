import { Realtime } from "@repo/core"
import { Effect } from "effect"
import type { WorkerRoute } from "./routes"
import { runtime } from "./runtime"

const pattern = /^\/ws\/rooms\/([^/]+)$/

/** WebSocket upgrades on `/ws/rooms/<roomId>` go to that room's Durable Object. */
export const realtimeRoute: WorkerRoute = async (request) => {
  const match = pattern.exec(new URL(request.url).pathname)
  if (match?.[1] === undefined) return undefined
  const roomId = decodeURIComponent(match[1])
  return runtime.runPromise(
    Effect.gen(function* () {
      const realtime = yield* Realtime
      return yield* realtime.connect(roomId, request)
    }).pipe(Effect.catch(() => Effect.succeed(new Response("Realtime error", { status: 502 })))),
  )
}
