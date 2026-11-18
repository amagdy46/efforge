import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { greet, InvalidName } from "../src/greeting"

// it.effect runs each test with test services: `Clock` is a TestClock that starts at 0 and only
// moves when the test moves it. It is the test layer Effect ships for time.
it.effect("greets a trimmed name at the server's time", () =>
  Effect.gen(function* () {
    yield* TestClock.adjust("90 minutes")
    const greeting = yield* greet("  Ada ")
    expect(greeting).toEqual({ message: "Hello, Ada", at: 90 * 60 * 1000 })
  }),
)

it.effect("fails with InvalidName for a blank name", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(greet("   "))
    expect(error).toBeInstanceOf(InvalidName)
  }),
)
