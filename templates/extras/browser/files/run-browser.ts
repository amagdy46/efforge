import { Browser } from "@repo/core"
import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { runtime } from "./runtime"

const RunInput = Schema.Struct({
  url: Schema.String.check(Schema.isPattern(/^https?:\/\//i), Schema.isMaxLength(2048)),
})

/**
 * Loads `url` in the browser container and returns the page title and request count. The
 * container refuses private and local addresses (see apps/browser/src/server.ts); add your own
 * auth check before exposing this to anonymous users.
 */
export const runBrowser = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(RunInput))
  .handler(({ data }) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const browser = yield* Browser
        return yield* browser.run(data.url)
      }),
    ),
  )
