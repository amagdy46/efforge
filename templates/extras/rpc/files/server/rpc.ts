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

const handler = Effect.map(serve, HttpEffect.toWebHandler)

/**
 * Serves the group at /api/rpc. Built once per isolate inside AppLayer, so
 * the telemetry slot under AppLayer traces every call.
 */
export const RpcLive = Layer.effect(RpcHandler, handler).pipe(
  Layer.provide([AppRpcsHandlers, RpcSerialization.layerNdjson]),
)
// #endregion
