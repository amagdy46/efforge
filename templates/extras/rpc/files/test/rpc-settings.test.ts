import { expect, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { RpcClient, RpcClientError } from "effect/rpc"
import { AppRpcs, rpcOverHttp } from "../src/rpc"
import { NotConfigured, RpcSettings, RpcSettingsClient } from "../src/rpc-settings"

/** What routes/api/rpc.ts answers when the app's layers could not start for a setting. */
const missingSetting = () =>
  Response.json(
    {
      _tag: "NotConfigured",
      setting: "LLM_API_KEY",
      file: ".dev.vars",
      problem: "LLM_API_KEY is not set.",
      message: "LLM_API_KEY is not set. Set LLM_API_KEY in .dev.vars and restart pnpm dev.",
    },
    { status: 503 },
  )

/** The browser's client, with `answer` in place of the server. */
const clientAnswered = (answer: () => Response) =>
  Layer.merge(
    rpcOverHttp("http://app.test/api/rpc").pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, () => Promise.resolve(answer()))),
    ),
    RpcSettingsClient,
  )

const Rpcs = AppRpcs.middleware(RpcSettings)

layer(clientAnswered(missingSetting))("a missing setting on the server", (it) => {
  it.effect("arrives as NotConfigured, naming the setting", () =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(Rpcs)
      const error = yield* Effect.flip(client.Greet({ name: "Ada" }))
      expect(error).toBeInstanceOf(NotConfigured)
      expect(error).toMatchObject({ setting: "LLM_API_KEY", file: ".dev.vars" })
    }).pipe(Effect.scoped),
  )
})

/** The same outside development: the setting's name and nothing else. */
const missingInProduction = () =>
  Response.json(
    {
      _tag: "NotConfigured",
      setting: "LLM_API_KEY",
      problem: "LLM_API_KEY is not configured.",
      message: "LLM_API_KEY is not configured.",
    },
    { status: 503 },
  )

layer(clientAnswered(missingInProduction))("a missing setting on a deployed Worker", (it) => {
  it.effect("arrives as NotConfigured, with no file", () =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(Rpcs)
      const error = yield* Effect.flip(client.Greet({ name: "Ada" }))
      expect(error).toBeInstanceOf(NotConfigured)
      expect(error).toMatchObject({ setting: "LLM_API_KEY" })
      expect(error).not.toHaveProperty("file")
    }).pipe(Effect.scoped),
  )
})

layer(clientAnswered(() => new Response("Service Unavailable", { status: 503 })))(
  "any other 503",
  (it) => {
    it.effect("stays an RpcClientError", () =>
      Effect.gen(function* () {
        const client = yield* RpcClient.make(Rpcs)
        const error = yield* Effect.flip(client.Greet({ name: "Ada" }))
        expect(error).toBeInstanceOf(RpcClientError.RpcClientError)
      }).pipe(Effect.scoped),
    )
  },
)
