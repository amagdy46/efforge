import { rpcOverHttp } from "@repo/core/rpc"
import { RpcSessionClient, SessionRpcs } from "@repo/core/rpc-session"
import { Effect, Layer, Stream } from "effect"
import { AtomRpc } from "effect/reactivity"

// #region card
/** The typed client for /api/rpc. A failure arrives as its error's class. */
export class AppClient extends AtomRpc.Service<AppClient>()("AppClient", {
  group: SessionRpcs,
  protocol: Layer.merge(rpcOverHttp("/api/rpc"), RpcSessionClient),
}) {}

/** Call it with `{ payload: { name } }`; its value is an `AsyncResult`. */
export const greetAtom = AppClient.mutation("Greet")

/** The latest number the server sent, until the stream ends. */
export const countdownAtom = AppClient.runtime.fn((from: number) =>
  Stream.unwrap(AppClient.use((c) => Effect.succeed(c("Countdown", { from })))),
)
// #endregion
