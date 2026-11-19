/**
 * Limits and pure helpers shared by the room (server) and `useRoom` (browser). No imports, so the
 * client bundle stays free of Effect.
 */

/** Room ids: 1-64 letters, digits, `_` or `-`. */
export const ROOM_ID_PATTERN = /^[\w-]{1,64}$/

export const isValidRoomId = (roomId: string): boolean => ROOM_ID_PATTERN.test(roomId)

/** Largest message a client may send, in UTF-8 bytes. */
export const MAX_MESSAGE_BYTES = 4096

/** Most clients connected to one room at a time. */
export const MAX_ROOM_CONNECTIONS = 100

/** Messages `useRoom` keeps in memory. */
export const MAX_KEPT_MESSAGES = 200

const encoder = new TextEncoder()

export const isMessageTooLarge = (message: string): boolean =>
  encoder.encode(message).byteLength > MAX_MESSAGE_BYTES

/** How long a new socket has to send its first ping (`useRoom` sends one when it opens). */
export const JOIN_GRACE_MS = 10_000

/**
 * Whether the room counts a socket and sends to it: it has pinged since the handshake, or it was
 * accepted less than `JOIN_GRACE_MS` ago. A client that closes its socket before or during the
 * handshake (a reload, React StrictMode running an effect twice) can leave the room's end open
 * with nobody there; it never pings, so once the grace period is over the room closes it.
 */
export const isAttended = (
  socket: { readonly pinged: boolean; readonly acceptedAt: number | undefined },
  now: number,
): boolean =>
  socket.pinged || (socket.acceptedAt !== undefined && now - socket.acceptedAt < JOIN_GRACE_MS)

const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30_000

/**
 * Milliseconds to wait before reconnect number `attempt` (0 for the first): exponential from 1 s,
 * capped at 30 s, with half of it randomised so dropped clients don't all return at once.
 */
export const reconnectDelay = (attempt: number, random: () => number = Math.random): number => {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt))
  return Math.round(ceiling / 2 + (random() * ceiling) / 2)
}
