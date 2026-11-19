import { expect, layer } from "@effect/vitest"
import { Effect, Fiber, Layer, Stream } from "effect"
import { FetchHttpClient, HttpEffect } from "effect/http"
import { RpcClient, RpcSerialization, RpcServer } from "effect/rpc"
import { TestClock } from "effect/testing"
import { InvalidName } from "../src/greeting"
import { AppRpcs, rpcOverHttp } from "../src/rpc"
import { AppRpcsHandlers } from "../src/rpc-handlers"

/**
 * The server's handler answering the client's `fetch` in memory: each call
 * crosses the wire as ndjson, as it does from the browser, with no network.
 */
const ServerInMemory = Layer.effect(
  FetchHttpClient.Fetch,
  Effect.map(RpcServer.toHttpEffect(AppRpcs), (http) => {
    const handle = HttpEffect.toWebHandler(http)
    return (...request: Parameters<typeof fetch>) => handle(new Request(...request))
  }),
).pipe(Layer.provide([AppRpcsHandlers, RpcSerialization.layerNdjson]))

const ClientInMemory = rpcOverHttp("http://app.test/api/rpc").pipe(Layer.provide(ServerInMemory))

layer(ClientInMemory)("AppRpcs", (it) => {
  it.effect("Greet fails with InvalidName, its fields intact", () =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(AppRpcs)
      const error = yield* Effect.flip(client.Greet({ name: "  " }))
      expect(error).toBeInstanceOf(InvalidName)
      expect(error).toMatchObject({ length: 0, message: "A name is 1 to 40 characters." })
      expect((yield* client.Greet({ name: "Ada" })).message).toBe("Hello, Ada")
    }).pipe(Effect.scoped),
  )

  it.effect("Countdown streams a number each time the clock moves", () =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(AppRpcs)
      const fiber = yield* Stream.runCollect(client.Countdown({ from: 3 })).pipe(Effect.forkScoped)
      yield* TestClock.adjust("2 seconds")
      expect(yield* Fiber.join(fiber)).toEqual([3, 2, 1, 0])
    }).pipe(Effect.scoped),
  )
})
