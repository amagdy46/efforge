import { Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Rpc, RpcClient, RpcGroup, RpcSerialization } from "effect/rpc"
import { InvalidName } from "./greeting"
import { NotesUnavailable } from "./notes"

const Greeting = Schema.Struct({ message: Schema.String, at: Schema.Finite })
const Note = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  createdAt: Schema.Date,
})

// #region card
/**
 * The app's RPC group: one contract the server and the browser share. A
 * call's tagged error reaches the browser as its class, fields included.
 */
export class AppRpcs extends RpcGroup.make(
  Rpc.make("Greet", {
    payload: { name: Schema.String.check(Schema.isMaxLength(200)) },
    success: Greeting,
    error: InvalidName,
  }),
  Rpc.make("Countdown", {
    payload: {
      from: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
    },
    success: Schema.Int,
    stream: true,
  }),
  Rpc.make("ListNotes", {
    success: Schema.Array(Note),
    error: NotesUnavailable,
  }),
) {}
// #endregion

/** fetch, where an answer other than 2xx is an error (the session gate's 401, a 500) */
const HttpClientOk = Layer.effect(
  HttpClient.HttpClient,
  HttpClient.HttpClient.useSync(HttpClient.filterStatusOk),
).pipe(Layer.provide(FetchHttpClient.layer))

/** How a client reaches the group at `url`: ndjson over HTTP. The browser and the tests use it. */
export const rpcOverHttp = (url: string) =>
  RpcClient.layerProtocolHttp({ url }).pipe(
    Layer.provide([HttpClientOk, RpcSerialization.layerNdjson]),
  )
