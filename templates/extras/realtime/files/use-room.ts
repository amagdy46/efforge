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

/** Connects to a room and returns its last 200 messages. Reconnects with exponential backoff and jitter (up to 30 s). */
export function useRoom(roomId: string) {
  const [messages, setMessages] = useState<ReadonlyArray<RoomMessage>>([])
  const [status, setStatus] = useState<RoomStatus>("connecting")
  const [reason, setReason] = useState("")
  const nextId = useRef(0)
  const socket = useRef<WebSocket | null>(null)

  useEffect(() => {
    let closed = false
    let attempt = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    let ping: ReturnType<typeof setInterval> | undefined

    // #region card
    const connect = () => {
      setStatus("connecting")
      const scheme = location.protocol === "https:" ? "wss" : "ws"
      const ws = new WebSocket(
        `${scheme}://${location.host}/ws/rooms/${encodeURIComponent(roomId)}`,
      )
      socket.current = ws
      ws.addEventListener("open", () => {
        setStatus("open")
        attempt = 0
        // the first ping tells the room a client is here (see realtime/Room.ts)
        ws.send(PING)
        ping = setInterval(() => ws.send(PING), 30_000)
      })
      ws.addEventListener("message", ({ data }: MessageEvent) => {
        if (typeof data === "string" && data !== PONG) {
          const message = { id: nextId.current++, text: data }
          setMessages((all) => [...all, message].slice(-MAX_KEPT_MESSAGES))
        }
      })
      ws.addEventListener("close", (event: CloseEvent) => {
        clearInterval(ping)
        if (event.code === NOT_SIGNED_IN) {
          setStatus("refused")
          setReason(event.reason)
        } else {
          setStatus("closed")
          if (!closed) retry = setTimeout(connect, reconnectDelay(attempt++))
        }
      })
    }
    // #endregion
    connect()

    return () => {
      closed = true
      clearTimeout(retry)
      clearInterval(ping)
      const ws = socket.current
      // closing mid-handshake can leave the room's end open; close once the handshake is done
      if (ws?.readyState === WebSocket.CONNECTING)
        ws.addEventListener("open", () => ws.close(), { once: true })
      else ws?.close()
    }
  }, [roomId])

  const send = useCallback((message: string) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(message)
  }, [])

  return { messages, status, reason, send }
}
