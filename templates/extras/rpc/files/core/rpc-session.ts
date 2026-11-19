import { Effect } from "effect"
import { HttpClientError, type Headers } from "effect/http"
import { RpcClientError, RpcMiddleware } from "effect/rpc"
import { Auth, type Session, Unauthorized } from "./Auth"
import { AppRpcs } from "./rpc"

// #region card
/**
 * The session rule for RPC: a call without a session fails with
 * `Unauthorized`, and a handler gets `Auth` for the caller.
 */
export class RpcSession extends RpcMiddleware.Service<
  RpcSession,
  {
    readonly provides: Auth
  }
>()("RpcSession", { error: Unauthorized, requiredForClient: true }) {}

/** `AppRpcs` behind the session rule. */
export class SessionRpcs extends AppRpcs.middleware(RpcSession) {}
// #endregion

const notSignedIn = () => new Unauthorized({ message: "Not signed in" })

/**
 * `RpcSession` on the server, given how to find the session of a request's
 * headers (server/rpc.ts asks Better Auth).
 */
export const makeRpcSession = (
  sessionOf: (headers: Headers.Headers) => Effect.Effect<Session | undefined>,
) =>
  RpcSession.of((effect, { headers }) =>
    Effect.flatMap(sessionOf(headers), (session) =>
      session === undefined
        ? Effect.fail(notSignedIn())
        : Effect.provideService(
            effect,
            Auth,
            Auth.of({
              currentSession: Effect.succeed(session).pipe(Effect.withSpan("Auth.currentSession")),
            }),
          ),
    ),
  )

/** Whether `error` is the session gate's 401: `/api/` refused the call (api-session.ts). */
const refusedBySessionGate = (error: unknown) =>
  error instanceof RpcClientError.RpcClientError &&
  error.reason._tag === "HttpError" &&
  error.reason.cause instanceof HttpClientError.StatusCodeError &&
  error.reason.cause.response.status === 401

/**
 * `RpcSession` in the browser. The session gate answers before RPC runs, so
 * its 401 is no RPC answer; this turns it into the group's `Unauthorized`.
 */
export const RpcSessionClient = RpcMiddleware.layerClient(RpcSession, ({ next, request }) =>
  next(request).pipe(Effect.catchIf(refusedBySessionGate, () => Effect.fail(notSignedIn()))),
)
