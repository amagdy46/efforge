import { Context, Effect, Layer, Ref } from "effect"
import { Browser, UrlRefused } from "../src/browser"

/** Every URL `BrowserInMemory` was asked to open, in order. */
export class Visited extends Context.Service<Visited, Ref.Ref<ReadonlyArray<string>>>()(
  "test/Visited",
) {}

/**
 * `Browser` without a container: every page is titled after its host and made 3 requests, and
 * `localhost` is refused with `UrlRefused`, as the container's URL policy does. Opened URLs land in
 * `Visited`. Use it in place of `BrowserLive` to test code that opens pages.
 */
export const BrowserInMemory = Layer.effect(
  Browser,
  Effect.gen(function* () {
    const visited = yield* Visited
    return Browser.of({
      run: (url) =>
        Effect.gen(function* () {
          yield* Ref.update(visited, (all) => [...all, url])
          const host = new URL(url).hostname
          if (host === "localhost")
            return yield* new UrlRefused({ message: `The browser refused ${url}.`, url })
          return { title: host, requests: 3, screenshot: "" }
        }),
    })
  }),
).pipe(Layer.provideMerge(Layer.effect(Visited, Ref.make<ReadonlyArray<string>>([]))))
