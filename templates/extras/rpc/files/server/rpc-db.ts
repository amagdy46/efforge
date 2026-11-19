import { AppRpcs } from "@repo/core/rpc"
import { AppRpcsHandlers } from "@repo/core/rpc-handlers"
import { DatabaseLayer } from "@repo/db"
import { Context, Effect, Layer } from "effect"
import { HttpEffect } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { WorkerEnvLive } from "./cloudflare"

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
 * Serves the group at /api/rpc. Built once per isolate inside AppLayer: the
 * handlers get AppLayer's own Notes, and the telemetry slot traces each call.
 */
export const RpcLive = Layer.effect(RpcHandler, handler).pipe(
  Layer.provide([AppRpcsHandlers, RpcSerialization.layerNdjson]),
  Layer.provide(DatabaseLayer.pipe(Layer.provide(WorkerEnvLive))),
)
// #endregion
