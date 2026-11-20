import { Context, Effect, Schema } from "effect"
import { isMessageTooLarge, MAX_MESSAGE_BYTES } from "./realtime-limits"
import { ServerOnly } from "./server-only"

/** The room could not be reached; `message` says what failed, `cause` (server only) why. */
export class RealtimeError extends Schema.TaggedError<
  RealtimeError,
  { readonly brand: unique symbol }
>()("RealtimeError", {
  operation: Schema.Literals(["connect", "broadcast", "connections"]),
  message: Schema.String,
  cause: ServerOnly,
}) {}

/** Rooms of WebSocket clients. The Cloudflare layer keeps each room in a Durable Object. */
export class Realtime extends Context.Service<
  Realtime,
  {
    /** Forwards a WebSocket upgrade request to the room; the response completes the handshake. */
    readonly connect: (roomId: string, request: Request) => Effect.Effect<Response, RealtimeError>
    /** Sends `message` to every client connected to the room. */
    readonly broadcast: (roomId: string, message: string) => Effect.Effect<void, RealtimeError>
    /** Number of clients currently connected to the room. */
    readonly connections: (roomId: string) => Effect.Effect<number, RealtimeError>
  }
>()("@repo/core/Realtime") {}

// #region card
/** A message is larger than a room accepts (`limit` bytes). */
export class MessageTooLarge extends Schema.TaggedError<
  MessageTooLarge,
  { readonly brand: unique symbol }
>()("MessageTooLarge", { message: Schema.String, limit: Schema.Number }) {}

/** Sends `text` to everyone in the room; returns how many are in it. */
export const announce = (
  roomId: string,
  text: string,
): Effect.Effect<number, MessageTooLarge | RealtimeError, Realtime> =>
  Effect.gen(function* () {
    if (isMessageTooLarge(text))
      return yield* new MessageTooLarge({
        message: `Messages are at most ${MAX_MESSAGE_BYTES} bytes.`,
        limit: MAX_MESSAGE_BYTES,
      })
    const realtime = yield* Realtime
    yield* realtime.broadcast(roomId, text)
    return yield* realtime.connections(roomId)
  })
// #endregion
