import { isMessageTooLarge, MAX_ROOM_CONNECTIONS } from "@repo/core/realtime-limits"
import { Effect, Layer, Option, Schema } from "effect"
import { DurableObject, DurableObjectState, DurableObjectWebSocket, Worker } from "effect-cf"

export class RoomNamespace extends DurableObject.Tag<RoomNamespace>()("Room", {
  broadcast: DurableObject.method({ args: [Schema.String], success: Schema.Void }),
  connections: DurableObject.method({ success: Schema.Finite }),
}) {}

/** When the room accepted a socket. */
const Accepted = DurableObjectWebSocket.attachment(Schema.Struct({ at: Schema.Finite }))

/** How long a new socket has to send its first ping (`useRoom` sends one when it opens). */
const JOIN_GRACE_MS = 10_000

/**
 * The sockets with a client on the other end. A client that closes its socket before or during
 * the handshake (a reload, React StrictMode running an effect twice) can leave the room's end
 * open with nobody there. It never pings, so once the grace period is over it is closed and
 * neither counted nor sent to.
 */
const sockets = Effect.gen(function* () {
  const state = yield* DurableObjectState.DurableObjectState
  const live: Array<DurableObjectWebSocket.DurableWebSocket> = []
  for (const socket of yield* state.getWebSockets()) {
    const pinged = state.raw.getWebSocketAutoResponseTimestamp(socket.raw) !== null
    const accepted = yield* Accepted.deserialize(socket).pipe(
      Effect.orElseSucceed(() => Option.none()),
    )
    const joining = Option.exists(accepted, ({ at }) => Date.now() - at < JOIN_GRACE_MS)
    if (pinged || joining) live.push(socket)
    else yield* Effect.ignore(socket.close(1001, "No ping since the handshake"))
  }
  return live
})

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
    if ((yield* sockets).length >= MAX_ROOM_CONNECTIONS)
      return new Response("Room is full", { status: 503 })
    const { server, response } = yield* DurableObjectWebSocket.acceptUpgrade()
    yield* Effect.ignore(Accepted.serialize(server, { at: Date.now() }))
    return response
  }),
  // binary frames are ignored; oversized text closes the sender (1009 = message too big)
  webSocketMessage: (socket, message) => {
    if (typeof message !== "string") return Effect.void
    if (isMessageTooLarge(message)) return Effect.ignore(socket.close(1009, "Message too big"))
    return broadcast(message)
  },
  webSocketClose: (socket, code, reason) => Effect.ignore(socket.close(code, reason)),
  webSocketError: (socket) => Effect.ignore(socket.close(1011, "Socket error")),
}) {}
