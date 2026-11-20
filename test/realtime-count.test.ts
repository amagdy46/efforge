import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { isAttended, JOIN_GRACE_MS } from "../templates/extras/realtime/files/realtime-limits.ts"

// The realtime card's "broadcast it to N clients" under `pnpm dev`, where one tab used to count 4,
// then 5, 6, 7 after reloads: StrictMode opens a socket and closes it during the handshake, and
// the room never hears that close, so its end stays open with nobody there. The room's count is
// the sockets `isAttended` keeps (Room.ts); this replays what the room saw.

const files = new URL("../templates/extras/realtime/files/", import.meta.url).pathname

interface RoomSocket {
  readonly acceptedAt: number
  pinged: boolean
}

/** One page load under StrictMode: a socket abandoned in the handshake, then the one it keeps. */
const load = (room: RoomSocket[], at: number) => {
  room.push({ acceptedAt: at, pinged: false })
  const kept = { acceptedAt: at, pinged: false }
  room.push(kept)
  return kept
}

const counted = (room: ReadonlyArray<RoomSocket>, now: number) =>
  room.filter((s) => isAttended(s, now)).length

it("one tab, three reloads under StrictMode: the room counts one client", () => {
  const room: RoomSocket[] = []
  let t = 0
  let tab = load(room, t)
  tab.pinged = true
  for (let reload = 0; reload < 3; reload++) {
    t += 15_000
    // the old page's live socket closes properly (the room hears it); its abandoned one does not
    room.splice(room.indexOf(tab), 1)
    tab = load(room, t)
    tab.pinged = true
  }
  // what the room used to count: every socket it still holds
  expect(room.length).toBe(5)
  // once the latest load's abandoned socket is past its grace period, only the tab counts
  expect(counted(room, t + JOIN_GRACE_MS)).toBe(1)
  // right after a load, the abandoned socket may still be in its grace period
  expect(counted(room, t + 1)).toBeLessThanOrEqual(2)
})

it("bare sockets closed straight away are not counted after the grace period", () => {
  const room: RoomSocket[] = [{ acceptedAt: 0, pinged: true }]
  for (let i = 0; i < 3; i++) room.push({ acceptedAt: 1000, pinged: false })
  expect(counted(room, 1000 + JOIN_GRACE_MS + 1)).toBe(1)
})

it("the room counts and sends to exactly the sockets isAttended keeps, and closes the rest", () => {
  const room = readFileSync(`${files}Room.ts`, "utf8")
  expect(room).toMatch(
    /if \(isAttended\(\{ pinged, acceptedAt \}, Date\.now\(\)\)\) live\.push\(socket\)/,
  )
  expect(room).toMatch(/else yield\* Effect\.ignore\(socket\.close\(/)
  expect(room).toMatch(/connections: \(\) => Effect\.map\(sockets, \(all\) => all\.length\)/)
  expect(room).toMatch(
    /for \(const socket of yield\* sockets\) yield\* Effect\.ignore\(socket\.send/,
  )
  // and the client pings as soon as it opens, which is what marks it attended
  expect(readFileSync(`${files}use-room.ts`, "utf8")).toMatch(/ping/)
})
