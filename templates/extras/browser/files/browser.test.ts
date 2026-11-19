import { expect, layer } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { InvalidUrl, UrlRefused, visit } from "../src/browser"
import { BrowserInMemory, Visited } from "./browser-in-memory"

layer(BrowserInMemory)("visit", (it) => {
  it.effect("opens the address as a normalised URL", () =>
    Effect.gen(function* () {
      const run = yield* visit("  HTTPS://Example.com ")
      expect(run.title).toBe("example.com")
      expect((yield* Ref.get(yield* Visited)).at(-1)).toBe("https://example.com/")
    }),
  )

  it.effect("refuses an address that is not http(s) with InvalidUrl and never opens it", () =>
    Effect.gen(function* () {
      const visited = yield* Visited
      const before = yield* Ref.get(visited)
      for (const url of ["example.com", "file:///etc/passwd", "javascript:alert(1)"])
        expect(yield* Effect.flip(visit(url)), url).toBeInstanceOf(InvalidUrl)
      expect(yield* Ref.get(visited)).toEqual(before)
    }),
  )

  it.effect("passes the browser's UrlRefused through", () =>
    Effect.gen(function* () {
      expect(yield* Effect.flip(visit("http://localhost:8080"))).toBeInstanceOf(UrlRefused)
    }),
  )
})
