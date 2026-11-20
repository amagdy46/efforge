import { Realtime } from "@repo/core"
import { isValidRoomId } from "@repo/core/realtime-limits"
import { Effect } from "effect"
import type { WorkerRoute } from "./routes"
import { runtime } from "./runtime"

const pattern = /^\/ws\/rooms\/([^/]+)$/

/**
 * Checks an upgrade passes before it reaches the room; one that answers turns the socket away.
 * On a stack with auth, efforge adds `requireSocketSession` (socket-session.ts), so a socket
 * without a session is closed with 4401 "Not signed in"; without auth the list is empty and any
 * client that can reach the app can join a room.
 */
const upgradeGuards: ReadonlyArray<WorkerRoute> = [/* efforge:upgrade-guards */]

const decodeRoomId = (encoded: string) => {
  try {
    return decodeURIComponent(encoded)
  } catch {
    return undefined
  }
}

/**
 * WebSocket upgrades on `/ws/rooms/<roomId>` go to that room's Durable Object. Room ids are 1-64
 * word characters or dashes (400 otherwise); the room caps connections and message size.
 */
export const realtimeRoute: WorkerRoute = async (request) => {
  const match = pattern.exec(new URL(request.url).pathname)
  if (match?.[1] === undefined) return undefined
  const roomId = decodeRoomId(match[1])
  if (roomId === undefined || !isValidRoomId(roomId))
    return new Response("Invalid room id", { status: 400 })
  const refused = (await Promise.all(upgradeGuards.map((guard) => guard(request)))).find(
    (answer) => answer !== undefined,
  )
  if (refused !== undefined) return refused
  return runtime
    .runPromise(
      Effect.gen(function* () {
        const realtime = yield* Realtime
        return yield* realtime.connect(roomId, request)
      }).pipe(Effect.orElseSucceed(() => new Response("Realtime error", { status: 502 }))),
    )
    .catch((error: unknown) => {
      // the runtime failed to build (a layer is misconfigured)
      console.error("Realtime unavailable:", error)
      return new Response("Server is not configured", { status: 500 })
    })
}
