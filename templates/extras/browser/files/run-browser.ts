import { Browser } from "@repo/core"
import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"
import { runtime } from "./runtime"

/** Loads `url` in the browser container and returns the page title and request count. */
export const runBrowser = createServerFn({ method: "POST" })
  .validator((input: { url: string }) => input)
  .handler(({ data }) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const browser = yield* Browser
        return yield* browser.run(data.url)
      }),
    ),
  )
