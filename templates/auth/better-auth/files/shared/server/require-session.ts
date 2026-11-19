import { Auth, type Session } from "@repo/core/Auth"
import { createMiddleware } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import publicServerFns from "./public-server-fns.json"
import { runtime } from "./runtime"

const user = Auth.use((auth) => auth.currentSession)
const middleware = createMiddleware({ type: "function" })

const listed: Readonly<Record<string, ReadonlyArray<string>>> = publicServerFns

/**
 * The names on the public list, by file (`public-server-fns.json`), checked as it is loaded.
 * A list of the wrong shape makes nothing public, and says so in the server log.
 */
const publicNames = ((): ReadonlyMap<string, ReadonlyArray<string>> => {
  const list: unknown = listed
  const valid =
    typeof list === "object" &&
    list !== null &&
    !Array.isArray(list) &&
    Object.values(list).every(
      (names) => Array.isArray(names) && names.every((n) => typeof n === "string"),
    )
  if (valid) return new Map(Object.entries(list as typeof listed))
  console.error(
    'apps/web/src/server/public-server-fns.json must be { "<file>": ["<name>", ...] }. Every server function requires a session until it is.',
  )
  return new Map()
})()

/**
 * Whether a server function is on the public list, by the file the TanStack compiler recorded
 * for it (relative to apps/web) and the name it is declared as.
 */
const isPublic = (fn: { readonly filename: string; readonly name: string } | undefined) =>
  fn !== undefined && publicNames.get(`apps/web/${fn.filename}`)?.includes(fn.name) === true

/** One session lookup per request, however many middlewares ask for it. */
const lookups = new WeakMap<Request, Promise<Session>>()
const currentSession = (): Promise<Session> => {
  const request = getRequest()
  const known = lookups.get(request)
  if (known !== undefined) return known
  const lookup = runtime.runPromise(user)
  lookups.set(request, lookup)
  return lookup
}

// #region card
/**
 * Runs before every server function (`functionMiddleware` in start.ts), so a
 * new one cannot forget it: the call is rejected with `Unauthorized` unless
 * someone is signed in. Only the functions in `public-server-fns.json` skip it.
 */
export const sessionGate = middleware.server(({ next, serverFnMeta }) =>
  isPublic(serverFnMeta) ? next() : currentSession().then(() => next()),
)

/**
 * The same check, with the session passed on as `context.session` for the
 * handler. Chain it with `.middleware([requireSession])`; efforge does that for
 * every card's server functions on auth stacks. The session is looked up once.
 */
export const requireSession = middleware.server(({ next }) =>
  currentSession().then((session) => next({ context: { session } })),
)
// #endregion
