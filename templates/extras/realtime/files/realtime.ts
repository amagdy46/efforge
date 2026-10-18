import { Realtime, RealtimeError } from "@repo/core"
import { Effect, Layer } from "effect"
import { RoomNamespace } from "../realtime/Room"
import { CloudflareEnv } from "./cloudflare"

const fail = (operation: string) => (cause: unknown) => new RealtimeError({ operation, cause })

const make = Effect.gen(function* () {
  const rooms = yield* RoomNamespace
  return Realtime.of({
    connect: (roomId, request) =>
      rooms
        .byName(roomId)
        .fetch(request)
        .pipe(Effect.mapError(fail("connect"))),
    broadcast: (roomId, message) =>
      rooms
        .byName(roomId)
        .broadcast(message)
        .pipe(Effect.mapError(fail("broadcast"))),
    connections: (roomId) =>
      rooms
        .byName(roomId)
        .connections()
        .pipe(Effect.mapError(fail("connections"))),
  })
})

/** `Realtime` on the ROOM Durable Object namespace. */
export const RealtimeLive = Layer.effect(Realtime, make).pipe(
  Layer.provide(RoomNamespace.layer({ binding: "ROOM" })),
  Layer.provide(CloudflareEnv),
)
