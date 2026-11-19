import { AppRpcsHandlers } from "@repo/core/rpc-handlers"
import { makeRpcSession, RpcSession, SessionRpcs } from "@repo/core/rpc-session"
import { DatabaseLayer } from "@repo/db"
import { Context, Effect, Layer } from "effect"
import { HttpEffect } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { AuthLive, BetterAuth } from "./auth-live"
import { WorkerEnvLive } from "./cloudflare"

/** The `/api/rpc` endpoint as a Web handler; routes/api/rpc.ts serves it. */
export class RpcHandler extends Context.Service<
  RpcHandler,
  (request: Request) => Promise<Response>
>()("RpcHandler") {}

/**
 * `RpcSession` with Better Auth: the session of the RPC request's own cookies,
 * the lookup `requireSession` makes for a server function.
 */
const RpcSessionLive = Layer.effect(
  RpcSession,
  BetterAuth.useSync((auth) =>
    makeRpcSession((headers) =>
      Effect.promise(() =>
        auth.api.getSession({ headers: new Headers(headers) }).catch(() => null),
      ).pipe(
        Effect.map((found) =>
          found === null
            ? undefined
            : {
                userId: found.user.id,
                email: found.user.email,
                name: found.user.name,
                activeOrganizationId: found.session.activeOrganizationId ?? null,
              },
        ),
        Effect.withSpan("RpcSession.sessionOf"),
      ),
    ),
  ),
)

// #region card
/** Each call is a span named after it (`rpc.Greet`), as `serverFn.greet` is. */
const serve = RpcServer.toHttpEffect(SessionRpcs, { spanPrefix: "rpc" })

const handler = Effect.map(serve, HttpEffect.toWebHandler)

/**
 * Serves the group at /api/rpc behind the session rule. Built once per
 * isolate inside AppLayer: the handlers get AppLayer's own Notes and Better
 * Auth, and the telemetry slot traces each call.
 */
export const RpcLive = Layer.effect(RpcHandler, handler).pipe(
  Layer.provide([AppRpcsHandlers, RpcSessionLive]),
  Layer.provide([AuthLive, DatabaseLayer.pipe(Layer.provide(WorkerEnvLive))]),
  Layer.provide(RpcSerialization.layerNdjson),
)
// #endregion
