import { Effect, Layer, Schema } from "effect"
import { DurableObject, DurableObjectState, DurableObjectWebSocket, Worker } from "effect-cf"

export class RoomNamespace extends DurableObject.Tag<RoomNamespace>()("Room", {
  broadcast: DurableObject.method({ args: [Schema.String], success: Schema.Void }),
  connections: DurableObject.method({ success: Schema.Finite }),
}) {}

const sockets = Effect.flatMap(DurableObjectState.DurableObjectState, (state) =>
  state.getWebSockets(),
)

const broadcast = (message: string) =>
  Effect.gen(function* () {
    for (const socket of yield* sockets) yield* Effect.ignore(socket.send(message))
  })

/**
 * One chat room. Sockets are hibernating: Cloudflare keeps them open while the object is evicted
 * from memory and wakes it only when a client sends a message, so idle rooms cost nothing.
 * Bound as ROOM in wrangler.jsonc and exported from `src/server.ts`.
 */
export class Room extends RoomNamespace.make(Layer.empty, {
  // ping/pong keepalives are answered by Cloudflare without waking the object
  initialize: DurableObjectWebSocket.installKeepalive(),
  rpc: {
    broadcast,
    connections: () => Effect.map(sockets, (all) => all.length),
  },
  fetch: Effect.gen(function* () {
    const request = yield* Worker.NativeRequest
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("Expected a WebSocket upgrade", { status: 426 })
    return (yield* DurableObjectWebSocket.acceptUpgrade()).response
  }),
  webSocketMessage: (_socket, message) =>
    typeof message === "string" ? broadcast(message) : Effect.void,
  webSocketClose: (socket, code, reason) => Effect.ignore(socket.close(code, reason)),
}) {}
