import { Browser, BrowserError, BrowserUnavailable, UrlRefused } from "@repo/core"
import { Duration, Effect, Layer, Schema } from "effect"
import { ContainerNamespace } from "effect-cf"
import { WorkerEnvLive } from "./cloudflare"

class BrowserNamespace extends ContainerNamespace.Tag<BrowserNamespace>()("BrowserNamespace") {}

const RunResult = Schema.Struct({
  title: Schema.String,
  requests: Schema.Finite,
  screenshot: Schema.String,
})
const decode = Schema.decodeUnknownEffect(RunResult)
const ErrorBody = Schema.Struct({ error: Schema.String })
const decodeError = Schema.decodeUnknownOption(ErrorBody)

const fail = (operation: string) => (cause: unknown) => new BrowserError({ operation, cause })

/** The container loads a page for up to 30 seconds; a first start also pulls and boots the image. */
const ANSWER_WITHIN = Duration.seconds(90)

/** Local dev without containers (Docker off, or containers turned off for `pnpm dev`). */
const notRunning = (cause: unknown) =>
  String(cause instanceof Error ? cause.message : cause).includes(
    "Containers have not been enabled",
  )
    ? new BrowserUnavailable({ message: "No browser container runs in local dev." })
    : fail("run")(cause)

const make = Effect.gen(function* () {
  const containers = yield* BrowserNamespace
  return Browser.of({
    run: (url) =>
      Effect.gen(function* () {
        // one shared instance; use a different name per tenant or job to run containers in parallel
        const response = yield* containers
          .byName("default")
          .fetch("http://container/run", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url }),
          })
          .pipe(Effect.mapError((error) => notRunning(error.cause)))
        const body = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: fail("run"),
        })
        const reason = decodeError(body)
        if (response.status === 403)
          return yield* new UrlRefused({
            message: `The browser refused ${url}: ${reason._tag === "Some" ? reason.value.error : "not allowed"}.`,
          })
        if (!response.ok)
          return yield* fail("run")(
            new Error(
              reason._tag === "Some" ? reason.value.error : `container answered ${response.status}`,
            ),
          )
        return yield* decode(body).pipe(Effect.mapError(fail("run")))
      }).pipe(
        Effect.timeoutOrElse({
          duration: ANSWER_WITHIN,
          orElse: () =>
            Effect.fail(
              fail("run")(new Error("The browser container did not answer in 90 seconds.")),
            ),
        }),
      ),
  })
})

/** `Browser` on the BROWSER container binding. */
export const BrowserLive = Layer.effect(Browser, make).pipe(
  Layer.provide(BrowserNamespace.layer({ binding: "BROWSER" })),
  Layer.provide(WorkerEnvLive),
)
