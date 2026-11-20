import { AppRpcs } from "@repo/core/rpc"
import { AppRpcsHandlers } from "@repo/core/rpc-handlers"
import { Context, Effect, Layer } from "effect"
import { HttpEffect } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"

/** The `/api/rpc` endpoint as a Web handler; routes/api/rpc.ts serves it. */
export class RpcHandler extends Context.Service<
  RpcHandler,
  (request: Request) => Promise<Response>
>()("RpcHandler") {}

// #region card
/** Each call is a span named after it (`rpc.Greet`), as `serverFn.greet` is. */
const serve = RpcServer.toHttpEffect(AppRpcs, { spanPrefix: "rpc" })

/** What the calls run on: the handlers' programs. */
const RpcServices = Layer.merge(AppRpcsHandlers, RpcSerialization.layerNdjson)

/**
 * Serves the group at /api/rpc, from AppLayer, so the telemetry slot traces
 * each call. Each request gets its own RPC server: on Workers, I/O belongs
 * to the request that started it.
 */
export const RpcLive = Layer.effect(
  RpcHandler,
  Effect.map(Effect.context<Layer.Success<typeof RpcServices>>(), (services) =>
    HttpEffect.toWebHandler(Effect.provide(Effect.flatten(serve), services)),
  ),
).pipe(Layer.provide(RpcServices))
// #endregion
