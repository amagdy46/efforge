import { Effect } from "effect"
import { BetterAuth } from "./auth-live"
import { runtime } from "./runtime"

// Server only: import it from Worker routes, never from a module the browser loads. (That is why it
// is not in require-session.ts, which the browser reaches through the server functions it guards.)

/** The close code and reason a WebSocket upgrade without a session gets. */
const NOT_SIGNED_IN = { code: 4401, reason: "Not signed in" } as const

/** Whether the request's cookies hold a session Better Auth accepts. */
export const signedIn = (headers: Headers) =>
  BetterAuth.use((auth) =>
    // a session Better Auth cannot read is no session
    Effect.promise(() => auth.api.getSession({ headers }).catch(() => null)).pipe(
      Effect.map((found) => found !== null),
    ),
  )

/**
 * `requireSession` for a WebSocket upgrade (a Worker route, outside any server function): the
 * same Better Auth session lookup, from the upgrade request's cookies. Undefined when signed in.
 * Otherwise the socket is accepted and closed at once with 4401 "Not signed in": a browser cannot
 * read the status of a refused upgrade, but it can read a close code. A request that is not an
 * upgrade gets a plain 401. efforge adds it to the realtime route's `upgradeGuards` on auth stacks.
 */
export const requireSocketSession = (request: Request): Promise<Response | undefined> =>
  runtime.runPromise(signedIn(request.headers)).then((ok) => {
    if (ok) return undefined
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response(NOT_SIGNED_IN.reason, { status: 401 })
    const pair = new WebSocketPair()
    pair[1].accept()
    pair[1].close(NOT_SIGNED_IN.code, NOT_SIGNED_IN.reason)
    return new Response(null, { status: 101, webSocket: pair[0] })
  })
