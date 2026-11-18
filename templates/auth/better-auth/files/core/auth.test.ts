import { expect, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Auth, sessionOrNull, Unauthorized } from "../src/Auth"

const ada = { userId: "user-1", email: "ada@example.com", name: "Ada" }

/** Test layers for `Auth`: a fixed session, and nobody signed in. */
const SignedIn = Layer.succeed(Auth, Auth.of({ currentSession: Effect.succeed(ada) }))
const SignedOut = Layer.succeed(
  Auth,
  Auth.of({ currentSession: Effect.fail(new Unauthorized({ message: "Not signed in" })) }),
)

layer(SignedIn)("signed in", (it) => {
  it.effect("sessionOrNull is the session", () =>
    Effect.gen(function* () {
      expect(yield* sessionOrNull).toEqual(ada)
    }),
  )
})

layer(SignedOut)("signed out", (it) => {
  it.effect("sessionOrNull is null", () =>
    Effect.gen(function* () {
      expect(yield* sessionOrNull).toBeNull()
    }),
  )
})
