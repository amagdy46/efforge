import { Auth, Unauthorized } from "@repo/core/Auth"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { waitUntil } from "cloudflare:workers"
import { Config, Context, Data, Effect, Layer, Option, Redacted } from "effect"
import { WorkerConfig } from "effect-cf"
import { type AuthInstance, makeAuth } from "./auth"
import { AuthDatabase, AuthDatabaseLayer } from "./auth-database"
import { authBaseURL, isWebURL } from "./auth-url"
import { WorkerEnvLive } from "./cloudflare"

const ignore = () => undefined

/** A Better Auth setting that is set but unusable; the runtime shows it as `NotConfigured`. */
class AuthConfigError extends Data.TaggedError("AuthConfigError")<{
  readonly setting: string
  readonly message: string
}> {}

/** BETTER_AUTH_URL, when set, must be an origin such as https://app.example.com. */
const checkURL = (value: Option.Option<string>) =>
  Option.match(value, {
    onNone: () => Effect.succeed(value),
    onSome: (url) =>
      isWebURL(url) || url.trim() === ""
        ? Effect.succeed(value)
        : Effect.fail(
            new AuthConfigError({
              setting: "BETTER_AUTH_URL",
              message: `BETTER_AUTH_URL is "${url}", which is not an http or https URL (use an origin such as https://app.example.com, or leave it empty).`,
            }),
          ),
  })

/** The Better Auth instance; `/api/auth/*` is served from it (see auth-route.ts). */
export class BetterAuth extends Context.Service<BetterAuth, AuthInstance>()("BetterAuth") {}

const BetterAuthLive = Layer.effect(
  BetterAuth,
  Effect.gen(function* () {
    const { database } = yield* AuthDatabase
    const provider = yield* WorkerConfig.provider
    const { secret, baseURL } = yield* Effect.all({
      secret: Config.Redacted("BETTER_AUTH_SECRET").parse(provider),
      baseURL: Config.option(Config.String("BETTER_AUTH_URL")).parse(provider),
    })
    const url = yield* checkURL(baseURL)
    const auth = makeAuth({
      database,
      secret: Redacted.value(secret),
      baseURL: authBaseURL(Option.getOrUndefined(url), import.meta.env.DEV),
    })
    // Better Auth finishes starting in a promise (`$context`), which under `pnpm dev` loads its
    // database adapter with a dynamic import: I/O that belongs to the request that built this layer.
    // workerd cancels a request's I/O when it ends, so if that request ends first (a Worker route
    // that never needs a session, such as a storage download), the promise never settles and every
    // later sign-in fails. `waitUntil` keeps that request alive until Better Auth has started. Do
    // not await it here instead: the layer is built once per isolate, so every request that arrives
    // meanwhile would wait on work owned by another request, and workerd fails it with "the
    // Worker's code had hung". On Workers, never await a promise across requests; keep layer
    // construction synchronous and hand slow work to waitUntil.
    waitUntil(auth.$context.then(ignore, ignore))
    return auth
  }),
).pipe(Layer.provide(AuthDatabaseLayer), Layer.provide(WorkerEnvLive))

const unauthorized = () => new Unauthorized({ message: "Not signed in" })

/** Provides `Auth` (and `BetterAuth`). The session is read from the cookies of the request being handled. */
export const AuthLive = Layer.effect(
  Auth,
  Effect.gen(function* () {
    const auth = yield* BetterAuth
    return Auth.of({
      currentSession: Effect.gen(function* () {
        const found = yield* Effect.tryPromise({
          try: () => auth.api.getSession({ headers: getRequestHeaders() }),
          catch: unauthorized,
        })
        if (found === null) return yield* unauthorized()
        return { userId: found.user.id, email: found.user.email, name: found.user.name }
      }).pipe(Effect.withSpan("Auth.currentSession")),
    })
  }),
).pipe(Layer.provideMerge(BetterAuthLive))
