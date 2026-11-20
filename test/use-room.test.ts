import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest"

// The realtime card's `connectRoom` (apps/web/src/lib/use-room.ts), run against a fake WebSocket:
// the order of events `alchemy dev` produced every time, where React's StrictMode opens a socket,
// closes it and opens another, and the first one's close arrives after the second is open.

const repo = new URL("..", import.meta.url).pathname
const files = join(repo, "templates/extras/realtime/files")
const cache = join(repo, "node_modules/.cache")
mkdirSync(cache, { recursive: true })
const tmp = mkdtempSync(join(cache, "efforge-use-room-"))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

type Listener = (event: { code?: number; reason?: string; data?: unknown }) => void

class FakeSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static all: FakeSocket[] = []
  readyState = FakeSocket.CONNECTING
  sent: string[] = []
  closeCalled = false
  private listeners: Array<{ type: string; fn: Listener; once: boolean }> = []
  constructor(readonly url: string) {
    FakeSocket.all.push(this)
  }
  addEventListener(type: string, fn: Listener, options?: { once?: boolean }) {
    this.listeners.push({ type, fn, once: options?.once === true })
  }
  send(message: string) {
    this.sent.push(message)
  }
  close() {
    this.closeCalled = true
  }
  fire(type: string, event: { code?: number; reason?: string; data?: unknown } = {}) {
    if (type === "open") this.readyState = FakeSocket.OPEN
    if (type === "close") this.readyState = FakeSocket.CLOSED
    for (const l of this.listeners.slice()) {
      if (l.type !== type) continue
      if (l.once) this.listeners = this.listeners.filter((x) => x !== l)
      l.fn(event)
    }
  }
}

/** `connectRoom` from the template, its imports pointed at the template files. */
const load = async (source = readFileSync(join(files, "use-room.ts"), "utf8")) => {
  const file = join(tmp, `use-room-${Math.random().toString(36).slice(2)}.ts`)
  writeFileSync(
    file,
    source
      .replace(/^import .* from "react"\n/m, "")
      .replace('"@repo/core/realtime-limits"', JSON.stringify(join(files, "realtime-limits.ts"))),
  )
  return (await import(file)) as {
    connectRoom: (
      url: string,
      on: {
        status: (s: string) => void
        message: (t: string) => void
        refused: (r: string) => void
      },
    ) => { close: () => void; send: (m: string) => void }
  }
}

beforeEach(() => {
  FakeSocket.all = []
  vi.stubGlobal("WebSocket", FakeSocket)
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** StrictMode's open, close, open; then the events in the order alchemy dev sent them. */
const strictModeLateClose = async (source?: string) => {
  const { connectRoom } = await load(source)
  const statuses: string[] = []
  const on = { status: (s: string) => statuses.push(s), message: () => {}, refused: () => {} }
  connectRoom("ws://app/ws/rooms/demo", on).close()
  connectRoom("ws://app/ws/rooms/demo", on)
  const [first, second] = FakeSocket.all as [FakeSocket, FakeSocket]
  first.fire("open")
  second.fire("open")
  first.fire("close", { code: 1006 })
  vi.advanceTimersByTime(60_000)
  return { statuses, first, second }
}

it("a socket the hook gave up on can't mark the live room closed, and isn't retried", async () => {
  const { statuses, first, second } = await strictModeLateClose()
  expect(statuses.at(-1)).toBe("open")
  // the first socket was closed once its handshake finished, and pinged nothing
  expect(first.closeCalled).toBe(true)
  expect(first.sent).toEqual([])
  expect(second.sent[0]).toBe("effect-cf:ping")
  expect(FakeSocket.all).toHaveLength(2)
})

it("the old listeners, without the live check, fail the same sequence", async () => {
  const old = readFileSync(join(files, "use-room.ts"), "utf8").replace(
    /\n\s*if \(!live\(\)\) return/g,
    "",
  )
  const { statuses } = await strictModeLateClose(old)
  // the card said "Disconnected, retrying" while the second socket was open
  expect(statuses.slice(statuses.indexOf("open"))).toContain("closed")
})

it("a live socket that closes reconnects; a refusal does not", async () => {
  const { connectRoom } = await load()
  const statuses: string[] = []
  const reasons: string[] = []
  connectRoom("ws://app/ws/rooms/demo", {
    status: (s) => statuses.push(s),
    message: () => {},
    refused: (r) => reasons.push(r),
  })
  const [first] = FakeSocket.all as [FakeSocket]
  first.fire("open")
  first.fire("close", { code: 1006 })
  vi.advanceTimersByTime(60_000)
  expect(FakeSocket.all).toHaveLength(2)
  const second = FakeSocket.all[1] as FakeSocket
  second.fire("close", { code: 4401, reason: "Not signed in" })
  vi.advanceTimersByTime(60_000)
  expect(FakeSocket.all).toHaveLength(2)
  expect(statuses.at(-1)).toBe("refused")
  expect(reasons).toEqual(["Not signed in"])
})
