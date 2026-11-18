import { Data, Effect } from "effect"
import { BetterAuth } from "./auth-live"
import type { WorkerRoute } from "./routes"
import { runtime } from "./runtime"

/** Better Auth's handler threw instead of answering. */
class AuthHandlerFailed extends Data.TaggedError("AuthHandlerFailed")<{
  readonly message: string
  readonly cause: unknown
}> {}

/**
 * A request from a host Better Auth does not accept (under `pnpm dev`, anything but localhost
 * while BETTER_AUTH_URL is unset): a 403 that says what to set, which the sign-in form shows.
 */
const hostNotAllowed = (request: Request) => {
  const { host, origin } = new URL(request.url)
  return Response.json(
    {
      code: "HOST_NOT_ALLOWED",
      message: `Sign-in from ${host} is not set up. Set BETTER_AUTH_URL=${origin} in .dev.vars (.env with Alchemy) and restart pnpm dev.`,
    },
    { status: 403 },
  )
}

/** Serves Better Auth's HTTP API under `/api/auth/*` (sign-in, sign-up, sessions, organizations). */
export const authRoute: WorkerRoute = async (request) => {
  if (!new URL(request.url).pathname.startsWith("/api/auth/")) return undefined
  return runtime.runPromise(
    Effect.gen(function* () {
      const auth = yield* BetterAuth
      return yield* Effect.tryPromise({
        try: () => auth.handler(request),
        catch: (cause) =>
          new AuthHandlerFailed({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      }).pipe(
        Effect.catch((error) =>
          /allowed hosts/.test(error.message)
            ? Effect.succeed(hostNotAllowed(request))
            : Effect.die(error.cause),
        ),
      )
    }),
  )
}
