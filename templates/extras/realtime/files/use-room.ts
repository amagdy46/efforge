import { useCallback, useEffect, useRef, useState } from "react"

export type RoomStatus = "connecting" | "open" | "closed"

// answered by Cloudflare without waking the room (see `installKeepalive` in realtime/Room.ts)
const PING = "effect-cf:ping"
const PONG = "effect-cf:pong"

/** Connects to a room and returns its messages. Reconnects after a drop. */
export function useRoom(roomId: string) {
  const [messages, setMessages] = useState<ReadonlyArray<string>>([])
  const [status, setStatus] = useState<RoomStatus>("connecting")
  const socket = useRef<WebSocket | null>(null)

  useEffect(() => {
    let closed = false
    let retry: ReturnType<typeof setTimeout> | undefined
    let ping: ReturnType<typeof setInterval> | undefined

    const connect = () => {
      setStatus("connecting")
      const scheme = location.protocol === "https:" ? "wss" : "ws"
      const ws = new WebSocket(
        `${scheme}://${location.host}/ws/rooms/${encodeURIComponent(roomId)}`,
      )
      socket.current = ws
      ws.onopen = () => {
        setStatus("open")
        ping = setInterval(() => ws.send(PING), 30_000)
      }
      ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data === "string" && event.data !== PONG)
          setMessages((all) => [...all, event.data as string])
      }
      ws.onclose = () => {
        clearInterval(ping)
        setStatus("closed")
        if (!closed) retry = setTimeout(connect, 1000)
      }
    }
    connect()

    return () => {
      closed = true
      clearTimeout(retry)
      clearInterval(ping)
      socket.current?.close()
    }
  }, [roomId])

  const send = useCallback((message: string) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(message)
  }, [])

  return { messages, status, send }
}
