import { Effect, Option, Schema } from "effect"
import { HttpClientError } from "effect/http"
import { RpcClientError, RpcMiddleware } from "effect/rpc"

/**
 * A setting the server needs is missing or unusable, so the app's layers could
 * not start and no call ran. The same tag and fields as the web app's
 * `NotConfigured` (apps/web/src/lib/outcome.ts), so a card shows it as its
 * "not configured" state, naming the setting and the file to put it in.
 */
export class NotConfigured extends Schema.TaggedError<
  NotConfigured,
  { readonly brand: unique symbol }
>()("NotConfigured", {
  setting: Schema.String,
  file: Schema.String,
  problem: Schema.String,
  message: Schema.String,
}) {}

/**
 * The browser's half of a missing setting. `/api/rpc` answers 503 with a
 * `NotConfigured` body before RPC runs (routes/api/rpc.ts), so the server
 * never sees this middleware; the client turns that answer into the error.
 */
export class RpcSettings extends RpcMiddleware.Service<
  RpcSettings,
  { readonly clientError: NotConfigured }
>()("RpcSettings", { requiredForClient: true }) {}

/** The 503 a call got back instead of an RPC answer, if that is what `error` is. */
const unavailable = (error: unknown) =>
  error instanceof RpcClientError.RpcClientError &&
  error.reason._tag === "HttpError" &&
  error.reason.cause instanceof HttpClientError.StatusCodeError &&
  error.reason.cause.response.status === 503
    ? Option.some(error.reason.cause.response)
    : Option.none()

const decodeNotConfigured = Schema.decodeUnknownEffect(NotConfigured)

/**
 * `RpcSettings` in the browser: a 503 whose body is a `NotConfigured` fails
 * the call with it; any other failure is left as it was.
 */
export const RpcSettingsClient = RpcMiddleware.layerClient(RpcSettings, ({ next, request }) =>
  next(request).pipe(
    Effect.catch((error) =>
      Option.match(unavailable(error), {
        onNone: () => Effect.fail(error),
        onSome: (response) =>
          response.json.pipe(
            Effect.flatMap(decodeNotConfigured),
            Effect.matchEffect({
              onFailure: () => Effect.fail(error),
              onSuccess: (missing) => Effect.fail(missing),
            }),
          ),
      }),
    ),
  ),
)
