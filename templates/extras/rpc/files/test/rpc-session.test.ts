import { expect, layer } from "@effect/vitest"
import { Effect, Layer, Schema, Stream } from "effect"
import { FetchHttpClient, HttpEffect } from "effect/http"
import { Rpc, RpcClient, RpcGroup, RpcSerialization, RpcServer, RpcTest } from "effect/rpc"
import { Auth, Unauthorized } from "../src/Auth"
import { Notes } from "../src/notes"
import { rpcOverHttp } from "../src/rpc"
import { AppRpcsHandlers } from "../src/rpc-handlers"
import { makeRpcSession, RpcSession, RpcSessionClient, SessionRpcs } from "../src/rpc-session"

/** A signed-in user; `activeOrganizationId` is for a project with organizations. */
const ada = { userId: "u1", email: "ada@example.com", name: "Ada", activeOrganizationId: null }

/** `RpcSession` that knows one session: the cookie `session=ada`. */
const RpcSessionTest = Layer.succeed(
  RpcSession,
  makeRpcSession((headers) => Effect.succeed(headers.cookie === "session=ada" ? ada : undefined)),
)

/** A request without the cookie, refused the way api-session.ts refuses it. */
const sessionGate = (request: Request) =>
  request.headers.get("cookie") === "session=ada"
    ? undefined
    : Response.json({ _tag: "Unauthorized", message: "Not signed in" }, { status: 401 })

/**
 * The browser's client (with `RpcSessionClient`) and the server's handler,
 * in memory; `gate` answers first, as the Worker's routes do.
 */
const clientBehind = (gate: (request: Request) => Response | undefined) =>
  Layer.merge(
    rpcOverHttp("http://app.test/api/rpc").pipe(
      Layer.provide(
        Layer.effect(
          FetchHttpClient.Fetch,
          Effect.map(RpcServer.toHttpEffect(SessionRpcs), (http) => {
            const handle = HttpEffect.toWebHandler(http)
            return (...args: Parameters<typeof fetch>) => {
              const request = new Request(...args)
              return Promise.resolve(gate(request) ?? handle(request))
            }
          }),
        ),
      ),
      Layer.provide([AppRpcsHandlers, RpcSessionTest, RpcSerialization.layerNdjson]),
      Layer.provide(
        Layer.succeed(Notes, Notes.of({ list: Effect.succeed([]), insert: Effect.die })),
      ),
    ),
    RpcSessionClient,
  )

layer(clientBehind(sessionGate))("SessionRpcs behind the session gate", (it) => {
  it.effect("the gate's 401 arrives as Unauthorized", () =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SessionRpcs)
      expect(yield* Effect.flip(client.Greet({ name: "Ada" }))).toBeInstanceOf(Unauthorized)
    }).pipe(Effect.scoped),
  )
})

layer(clientBehind(() => undefined))("SessionRpcs with no gate in front", (it) => {
  it.effect("RpcSession refuses a call without a session with Unauthorized", () =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SessionRpcs)
      const refused = yield* Effect.flip(Stream.runDrain(client.Countdown({ from: 1 })))
      expect(refused).toBeInstanceOf(Unauthorized)
      const signedIn = { headers: { cookie: "session=ada" } }
      expect((yield* client.Greet({ name: "Ada" }, signedIn)).message).toBe("Hello, Ada")
    }).pipe(Effect.scoped),
  )
})

/** A group of one call that answers who is calling, for the test below. */
class WhoamiRpcs extends RpcGroup.make(Rpc.make("Whoami", { success: Schema.String })).middleware(
  RpcSession,
) {}

const WhoamiHandlers = WhoamiRpcs.toLayer({
  Whoami: () => Effect.map(Effect.orDie(Auth.use((auth) => auth.currentSession)), (s) => s.email),
})

layer(Layer.mergeAll(WhoamiHandlers, RpcSessionTest, RpcSessionClient))("RpcSession", (it) => {
  it.effect("gives a handler Auth for the caller", () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(WhoamiRpcs)
      const email = yield* client.Whoami(undefined, { headers: { cookie: "session=ada" } })
      expect(email).toBe(ada.email)
    }).pipe(Effect.scoped),
  )
})
