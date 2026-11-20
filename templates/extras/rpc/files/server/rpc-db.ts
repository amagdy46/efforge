import { AppRpcs } from "@repo/core/rpc"
import { AppRpcsHandlers } from "@repo/core/rpc-handlers"
import { DatabaseLayer } from "@repo/db"
import { Context, Effect, Layer, Scope } from "effect"
import { HttpEffect } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { WorkerEnvLive } from "./cloudflare"

/** The `/api/rpc` endpoint as a Web handler; routes/api/rpc.ts serves it. */
export class RpcHandler extends Context.Service<
  RpcHandler,
  (request: Request) => Promise<Response>
>()("RpcHandler") {}

/** AppLayer's database layer; Effect builds it once, so this is the same one. */
const Database = DatabaseLayer.pipe(Layer.provide(WorkerEnvLive))

// #region card
/** Each call is a span named after it (`rpc.Greet`), as `serverFn.greet` is. */
const serve = RpcServer.toHttpEffect(AppRpcs, { spanPrefix: "rpc" })

/** What the calls run on: AppLayer's own Notes, shared by reference. */
const RpcServices = AppRpcsHandlers.pipe(
  Layer.merge(RpcSerialization.layerNdjson),
  Layer.provide(Database),
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
