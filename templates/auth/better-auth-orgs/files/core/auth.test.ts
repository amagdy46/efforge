import { expect, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import {
  activeOrganizationId,
  Auth,
  NoActiveOrganization,
  type Session,
  sessionOrNull,
  Unauthorized,
} from "../src/Auth"

const ada: Session = {
  userId: "user-1",
  email: "ada@example.com",
  name: "Ada",
  activeOrganizationId: "org-1",
}

/** Test layers for `Auth`: a fixed session, and nobody signed in. */
const signedIn = (session: Session) =>
  Layer.succeed(Auth, Auth.of({ currentSession: Effect.succeed(session) }))
const SignedOut = Layer.succeed(
  Auth,
  Auth.of({ currentSession: Effect.fail(new Unauthorized({ message: "Not signed in" })) }),
)

layer(signedIn(ada))("signed in, in an organization", (it) => {
  it.effect("sessionOrNull is the session", () =>
    Effect.gen(function* () {
      expect(yield* sessionOrNull).toEqual(ada)
    }),
  )

  it.effect("activeOrganizationId is the session's organization", () =>
    Effect.gen(function* () {
      expect(yield* activeOrganizationId).toBe("org-1")
    }),
  )
})

layer(signedIn({ ...ada, activeOrganizationId: null }))("signed in, no organization", (it) => {
  it.effect("activeOrganizationId fails with NoActiveOrganization", () =>
    Effect.gen(function* () {
      expect(yield* Effect.flip(activeOrganizationId)).toBeInstanceOf(NoActiveOrganization)
    }),
  )
})

layer(SignedOut)("signed out", (it) => {
  it.effect("sessionOrNull is null", () =>
    Effect.gen(function* () {
      expect(yield* sessionOrNull).toBeNull()
    }),
  )

  it.effect("activeOrganizationId fails with Unauthorized", () =>
    Effect.gen(function* () {
      expect(yield* Effect.flip(activeOrganizationId)).toBeInstanceOf(Unauthorized)
    }),
  )
})
