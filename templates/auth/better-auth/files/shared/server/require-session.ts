import { Auth } from "@repo/core/Auth"
import { createMiddleware } from "@tanstack/react-start"
import { runtime } from "./runtime"

const user = Auth.use((auth) => auth.currentSession)
const middleware = createMiddleware({ type: "function" })

// #region card
/**
 * Rejects the call with `Unauthorized` unless someone is signed in, and passes
 * the session on as `context.session`. Chain it on a server function with
 * `.middleware([requireSession])`; efforge does that for every card's server
 * functions, and for the browser, workflows and AI extras, on auth stacks.
 */
export const requireSession = middleware.server(({ next }) =>
  runtime.runPromise(user).then((session) => next({ context: { session } })),
)
// #endregion
