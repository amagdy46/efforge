import publicApiPaths from "./public-api-paths.json"
import type { WorkerRoute } from "./routes"
import { runtime } from "./runtime"
import { signedIn } from "./socket-session"

// Server only, like socket-session.ts: a Worker route, never imported by the browser.

/** A path segment with its percent-escapes decoded, or as it is when they are malformed. */
const decoded = (segment: string) => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * The path as the router may match it: each segment decoded, empty segments dropped, lower case
 * (TanStack's router matches paths without regard to case), and whether every segment is plain
 * (no `/`, `\\`, `.` or `..` hidden in an escape). Only a plain path can be public.
 */
const routedPath = (url: string) => {
  const segments = new URL(url).pathname
    .split("/")
    .filter((s) => s !== "")
    .map(decoded)
  return {
    path: `/${segments.join("/").toLowerCase()}`,
    plain: segments.every((s) => !/[/\\]/.test(s) && s !== "." && s !== ".."),
  }
}

const underApi = (path: string) => path === "/api" || path.startsWith("/api/")

/**
 * Every request under `/api/` needs a session, whatever answers it: a Worker route in
 * `workerRoutes` or a route file's `server: { handlers }`. Only the paths in
 * `public-api-paths.json` (Better Auth's own `/api/auth/`) answer without one. It is first in
 * `workerRoutes`, so nothing under `/api/` runs before it. Without a session: 401 with the same
 * `Unauthorized` tag a server function gives. Routes outside `/api/` check the session
 * themselves, as the realtime route does with `requireSocketSession`.
 */
export const requireApiSession: WorkerRoute = (request) => {
  const { path, plain } = routedPath(request.url)
  if (!underApi(path) || (plain && publicApiPaths.some((open) => path.startsWith(open))))
    return Promise.resolve(undefined)
  return runtime
    .runPromise(signedIn(request.headers))
    .then((ok) =>
      ok
        ? undefined
        : Response.json({ _tag: "Unauthorized", message: "Not signed in" }, { status: 401 }),
    )
}
