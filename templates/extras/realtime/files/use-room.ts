import { MAX_KEPT_MESSAGES, reconnectDelay } from "@repo/core/realtime-limits"
import { useCallback, useEffect, useRef, useState } from "react"

export interface RoomMessage {
  readonly id: number
  readonly text: string
}

/** `refused`: the room turned the socket away (no session on a stack with auth); no retry. */
export type RoomStatus = "connecting" | "open" | "closed" | "refused"

/** The close code the Worker uses for an upgrade without a session (realtime-route.ts). */
export const NOT_SIGNED_IN = 4401

// answered by Cloudflare without waking the room (see `installKeepalive` in realtime/Room.ts)
const PING = "effect-cf:ping"
const PONG = "effect-cf:pong"

export interface RoomEvents {
  readonly status: (status: RoomStatus) => void
  readonly message: (text: string) => void
  /** The room refused the socket, with the close reason ("Not signed in") */
  readonly refused: (reason: string) => void
}

/**
 * Opens a socket to the room at `url` and keeps one open, reconnecting with exponential backoff
 * and jitter (up to 30 s). `close` gives up for good. A socket it has given up on (closed, or
 * replaced by a reconnect) reports nothing, so its late close can't mark a live room closed:
 * React's StrictMode opens a socket, closes it and opens another.
 */
export function connectRoom(url: string, on: RoomEvents) {
  let closed = false
  let attempt = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  let ping: ReturnType<typeof setInterval> | undefined
  let current: WebSocket | undefined

  // #region card
  const connect = () => {
    on.status("connecting")
    const ws = new WebSocket(url)
    current = ws
    // a socket this call gave up on, or replaced, says nothing
    const live = () => !closed && current === ws
    ws.addEventListener("open", () => {
      if (!live()) return
      on.status("open")
      attempt = 0
      // the first ping tells the room a client is here (see realtime/Room.ts)
      ws.send(PING)
      ping = setInterval(() => ws.send(PING), 30_000)
    })
    ws.addEventListener("message", ({ data }: MessageEvent) => {
      if (live() && typeof data === "string" && data !== PONG) on.message(data)
    })
    ws.addEventListener("close", (event: CloseEvent) => {
      if (!live()) return
      clearInterval(ping)
      if (event.code === NOT_SIGNED_IN) {
        on.status("refused")
        on.refused(event.reason)
      } else {
        on.status("closed")
        retry = setTimeout(connect, reconnectDelay(attempt++))
      }
    })
  }
  // #endregion
  connect()

  return {
    send: (message: string) => {
      if (current?.readyState === WebSocket.OPEN) current.send(message)
    },
    close: () => {
      closed = true
      clearTimeout(retry)
      clearInterval(ping)
      const ws = current
      // closing mid-handshake can leave the room's end open; close once the handshake is done
      if (ws?.readyState === WebSocket.CONNECTING)
        ws.addEventListener("open", () => ws.close(), { once: true })
      else ws?.close()
    },
  }
}

/** Connects to a room and returns its last 200 messages, its status, and `send`. */
export function useRoom(roomId: string) {
  const [messages, setMessages] = useState<ReadonlyArray<RoomMessage>>([])
  const [status, setStatus] = useState<RoomStatus>("connecting")
  const [reason, setReason] = useState("")
  const nextId = useRef(0)
  const room = useRef<ReturnType<typeof connectRoom> | null>(null)

  useEffect(() => {
    const scheme = location.protocol === "https:" ? "wss" : "ws"
    const opened = connectRoom(
      `${scheme}://${location.host}/ws/rooms/${encodeURIComponent(roomId)}`,
      {
        status: setStatus,
        message: (text) => {
          const message = { id: nextId.current++, text }
          setMessages((all) => [...all, message].slice(-MAX_KEPT_MESSAGES))
        },
        refused: setReason,
      },
    )
    room.current = opened
    return opened.close
  }, [roomId])

  const send = useCallback((message: string) => room.current?.send(message), [])

  return { messages, status, reason, send }
}
