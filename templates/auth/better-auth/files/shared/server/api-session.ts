import publicApiPaths from "./public-api-paths.json"
import type { WorkerRoute } from "./routes"
import { runtime } from "./runtime"
import { signedIn } from "./socket-session"

// Server only, like socket-session.ts: a Worker route, never imported by the browser.

const listed: ReadonlyArray<string> = publicApiPaths

/**
 * The public prefixes (`public-api-paths.json`), checked as they are loaded: each starts with
 * `/api/` and ends with `/`. A list of the wrong shape makes nothing public, and says so in the
 * server log.
 */
const publicPaths = ((): ReadonlyArray<string> => {
  const list: unknown = listed
  if (
    Array.isArray(list) &&
    list.every((p) => typeof p === "string" && p.startsWith("/api/") && p.endsWith("/"))
  )
    return list as ReadonlyArray<string>
  console.error(
    'apps/web/src/server/public-api-paths.json must be ["/api/<prefix>/", ...]. Every request under /api/ requires a session until it is.',
  )
  return []
})()

/** A path segment with its percent-escapes decoded, or as it is when they are malformed. */
const decoded = (segment: string) => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * Whether the router may take the request for a path under `/api/`. It matches the path with
 * each segment decoded, empty segments dropped and without regard to case, so this reads it the
 * same way: `/API/x`, `/%61pi/x` and `/api%2Fx` are all under `/api/`.
 */
const underApi = (pathname: string) => {
  const path = `/${pathname
    .split("/")
    .filter((s) => s !== "")
    .map(decoded)
    .join("/")
    .toLowerCase()}`
  return path === "/api" || path.startsWith("/api/")
}

/**
 * Whether a public prefix serves the path, matched as its handler matches it: the raw path, case
 * and escapes as sent (`auth-route.ts` takes `pathname.startsWith("/api/auth/")`). Any other
 * spelling (`/API/auth/x`, `/%61pi/auth/x`) is not served there, so it is not public; nor is a
 * path with a `/`, `\\`, `.` or `..` hidden in an escape.
 */
const isPublic = (pathname: string) =>
  publicPaths.some((open) => pathname.startsWith(open)) &&
  pathname
    .split("/")
    .map(decoded)
    .every((s) => !/[/\\]/.test(s) && s !== "." && s !== "..")

/**
 * Every request under `/api/` needs a session, whatever answers it: a Worker route in
 * `workerRoutes` or a route file's `server: { handlers }`. Only the paths in
 * `public-api-paths.json` (Better Auth's own `/api/auth/`) answer without one. It is first in
 * `workerRoutes`, so nothing under `/api/` runs before it. Without a session: 401 with the same
 * `Unauthorized` tag a server function gives. Routes outside `/api/` check the session
 * themselves, as the realtime route does with `requireSocketSession`.
 */
export const requireApiSession: WorkerRoute = (request) => {
  const { pathname } = new URL(request.url)
  if (!underApi(pathname) || isPublic(pathname)) return Promise.resolve(undefined)
  return runtime
    .runPromise(signedIn(request.headers))
    .then((ok) =>
      ok
        ? undefined
        : Response.json({ _tag: "Unauthorized", message: "Not signed in" }, { status: 401 }),
    )
}
