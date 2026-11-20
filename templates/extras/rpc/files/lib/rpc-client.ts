import { AppRpcs, rpcOverHttp } from "@repo/core/rpc"
import { RpcSettings, RpcSettingsClient } from "@repo/core/rpc-settings"
import { Effect, Layer, Stream } from "effect"
import { AtomRpc } from "effect/reactivity"

// #region card
/**
 * The typed client for /api/rpc. A failure arrives as its error's class; a
 * missing setting on the server as `NotConfigured` (`RpcSettings`).
 */
export class AppClient extends AtomRpc.Service<AppClient>()("AppClient", {
  group: AppRpcs.middleware(RpcSettings),
  protocol: Layer.merge(rpcOverHttp("/api/rpc"), RpcSettingsClient),
}) {}

/** Call it with `{ payload: { name } }`; its value is an `AsyncResult`. */
export const greetAtom = AppClient.mutation("Greet")

/** The latest number the server sent, until the stream ends. */
export const countdownAtom = AppClient.runtime.fn((from: number) =>
  Stream.unwrap(AppClient.use((c) => Effect.succeed(c("Countdown", { from })))),
)
// #endregion
