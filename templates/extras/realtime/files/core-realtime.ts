import { Context, Data, Effect } from "effect"
import { isMessageTooLarge, MAX_MESSAGE_BYTES } from "./realtime-limits"

export class RealtimeError extends Data.TaggedError("RealtimeError")<{
  readonly operation: string
  readonly cause: unknown
}> {}

/** A message is larger than a room accepts (`MAX_MESSAGE_BYTES`). */
export class MessageTooLarge extends Data.TaggedError("MessageTooLarge")<{
  readonly message: string
}> {}

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
/** Sends a message from the server to everyone in the room, and says how many received it. */
export const announce = (
  roomId: string,
  text: string,
): Effect.Effect<number, MessageTooLarge | RealtimeError, Realtime> =>
  Effect.gen(function* () {
    if (isMessageTooLarge(text))
      return yield* new MessageTooLarge({
        message: `Messages are at most ${MAX_MESSAGE_BYTES} bytes.`,
      })
    const realtime = yield* Realtime
    yield* realtime.broadcast(roomId, text)
    return yield* realtime.connections(roomId)
  })
// #endregion
