import { ExternalLink } from "lucide-react"
import { type SubmitEvent, useState } from "react"
import { isMessageTooLarge, MAX_MESSAGE_BYTES } from "@repo/core/realtime-limits"
import { FailureNote } from "@/components/demo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { type RoomStatus, useRoom } from "@/lib/use-room"
import { useServerCall } from "@/lib/use-server-call"
import { cn } from "@/lib/utils"
import { announce } from "@/server/realtime-demo"
import program from "../../../../packages/core/src/realtime.ts?region=card"
import serverFn from "../server/realtime-demo.ts?region=card"
import hook from "../lib/use-room.ts?region=card"
import type { Capability } from "./types"

const statusText: Record<RoomStatus, string> = {
  connecting: "Connecting",
  open: "Connected",
  closed: "Disconnected, retrying",
}

/** Open the dashboard in two tabs: messages sent in one appear in the other, through a Durable Object. */
function RealtimeDemo() {
  const { messages, status, send } = useRoom("demo")
  const [text, setText] = useState("")
  const server = useServerCall(announce)
  const tooLarge = isMessageTooLarge(text)

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    if (text.trim() === "" || tooLarge) return
    send(text)
    setText("")
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">
          Realtime room <code className="font-mono font-normal">demo</code>
        </h4>
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full",
              status === "open" ? "bg-primary" : "bg-muted-foreground/50",
            )}
          />
          {statusText[status]}
        </p>
      </div>
      <ul
        aria-label="Room messages"
        aria-live="polite"
        className="h-36 space-y-1 overflow-y-auto rounded-md border bg-background p-3 text-sm"
      >
        {messages.length === 0 ? (
          <li className="text-muted-foreground">
            No messages yet. Say something, or send one from the server.
          </li>
        ) : (
          messages.map((message) => (
            <li key={message.id} className="break-words">
              {message.text}
            </li>
          ))
        )}
      </ul>
      <form onSubmit={submit} className="space-y-2">
        <Label htmlFor="realtime-text">Message</Label>
        <div className="flex gap-2">
          <Input
            id="realtime-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Say hi"
          />
          <Button type="submit" disabled={status !== "open" || tooLarge}>
            Send
          </Button>
        </div>
        {tooLarge ? (
          <p className="text-xs text-muted-foreground">
            Over the room's {MAX_MESSAGE_BYTES}-byte limit, so the room would close the socket. Send
            it from the server to see the <code className="font-mono">announce</code> program refuse
            it with <code className="font-mono">MessageTooLarge</code>.
          </p>
        ) : null}
      </form>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          variant="outline"
          size="sm"
          disabled={server.state.status === "running"}
          onClick={() =>
            void server.run({
              data: {
                text:
                  text.trim() === "" ? `From the server, ${new Date().toLocaleTimeString()}` : text,
              },
            })
          }
        >
          Send from the server
        </Button>
        <a
          href="/app#realtime"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
        >
          Open a second tab <ExternalLink aria-hidden className="size-3.5" />
        </a>
        {server.state.status === "done" ? (
          <p className="basis-full text-xs text-muted-foreground">
            The Realtime service broadcast it to {server.state.value}{" "}
            {server.state.value === 1 ? "client" : "clients"} in the room.
          </p>
        ) : null}
        {server.state.status === "failed" ? (
          <div className="basis-full">
            <FailureNote error={server.state.error} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const realtime: Capability = {
  id: "realtime",
  title: "Realtime",
  summary:
    "WebSocket rooms on a hibernating Durable Object, behind the Realtime service; the server can broadcast into any room.",
  layer: { name: "RealtimeLive", provides: ["Realtime"], needs: ["ROOM Durable Object"] },
  code: [
    { path: "packages/core/src/realtime.ts", source: program },
    { path: "apps/web/src/server/realtime-demo.ts", source: serverFn },
    { path: "apps/web/src/lib/use-room.ts", source: hook },
  ],
  files: [
    ["Service and program", "packages/core/src/realtime.ts"],
    ["Room (Durable Object)", "apps/web/src/realtime/Room.ts"],
  ],
  test: {
    path: "packages/core/test/realtime.test.ts",
    name: "refuses a message over the size limit with MessageTooLarge",
  },
  agents: "Realtime",
  Demo: RealtimeDemo,
}
