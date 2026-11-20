import { AppRpcsHandlers } from "@repo/core/rpc-handlers"
import { makeRpcSession, RpcSession, SessionRpcs } from "@repo/core/rpc-session"
import { DatabaseLayer } from "@repo/db"
import { Context, Effect, Layer, Scope } from "effect"
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

/** AppLayer's database layer; Effect builds it once, so this is the same one. */
const Database = DatabaseLayer.pipe(Layer.provide(WorkerEnvLive))

// #region card
/** Each call is a span named after it (`rpc.Greet`), as `serverFn.greet` is. */
const serve = RpcServer.toHttpEffect(SessionRpcs, { spanPrefix: "rpc" })

/** What the calls run on: AppLayer's own Notes and Better Auth. */
const RpcServices = AppRpcsHandlers.pipe(
  Layer.merge(RpcSessionLive),
  Layer.merge(RpcSerialization.layerNdjson),
  Layer.provide([AuthLive, Database]),
)

/**
 * Serves the group at /api/rpc, from AppLayer, so the telemetry slot traces
 * each call. Each request gets its own RPC server: on Workers, I/O belongs
 * to the request that started it.
 */
export const RpcLive = Layer.effect(
  RpcHandler,
  Effect.map(Effect.context<Layer.Success<typeof RpcServices>>(), (context) =>
    HttpEffect.toWebHandler(
      // without the layer's Scope: each request's server lives in its own
      Effect.provide(Effect.flatten(serve), Context.omit(Scope.Scope)(context)),
    ),
  ),
).pipe(Layer.provide(RpcServices))
// #endregion
