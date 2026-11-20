import { expect, layer } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { MissingName, startExample, UnknownRun, watchExample } from "../src/jobs"
import { JobsInMemory, Started } from "./jobs-in-memory"

layer(JobsInMemory)("example workflow", (it) => {
  it.effect("starts a run with the trimmed name", () =>
    Effect.gen(function* () {
      const run = yield* startExample("ada", { name: "  Ada ", failFirstAttempt: true })
      expect(run.id).toMatch(/^[0-9a-f]{32}_[0-9a-f-]{36}$/)
      expect((yield* Ref.get(yield* Started)).at(-1)).toEqual({
        name: "Ada",
        failFirstAttempt: true,
      })
    }),
  )

  it.effect("refuses a blank name with MissingName and starts nothing", () =>
    Effect.gen(function* () {
      const started = yield* Started
      const before = yield* Ref.get(started)
      const error = yield* Effect.flip(
        startExample("ada", { name: "   ", failFirstAttempt: false }),
      )
      expect(error).toBeInstanceOf(MissingName)
      expect(yield* Ref.get(started)).toEqual(before)
    }),
  )

  it.effect("reads on from the last event it saw, then the result", () =>
    Effect.gen(function* () {
      const run = yield* startExample("ada", { name: "Ada", failFirstAttempt: false })
      const watched = yield* watchExample("ada", run.id, 5)
      expect(watched.events.map((e) => e.type)).toEqual([
        "step_started",
        "step_completed",
        "workflow_completed",
      ])
      expect(watched.done).toBe(true)
      expect(watched.status).toBe("complete")
    }),
  )

  it.effect(
    "refuses another owner's run with UnknownRun, the same as a run that is not there",
    () =>
      Effect.gen(function* () {
        const run = yield* startExample("ada", { name: "Ada", failFirstAttempt: false })
        const error = yield* Effect.flip(watchExample("rev", run.id, -1))
        expect(error).toBeInstanceOf(UnknownRun)
        const none = yield* Effect.flip(watchExample("rev", "run-1", -1))
        expect(none).toEqual(error)
      }),
  )
})
