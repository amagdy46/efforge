import { expect, layer } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { MissingName, startExample, watchExample } from "../src/jobs"
import { JobsInMemory, Started } from "./jobs-in-memory"

layer(JobsInMemory)("example workflow", (it) => {
  it.effect("starts a run with the trimmed name", () =>
    Effect.gen(function* () {
      const run = yield* startExample("  Ada ", true)
      expect(run.id).toMatch(/^run-/)
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
      const error = yield* Effect.flip(startExample("   ", false))
      expect(error).toBeInstanceOf(MissingName)
      expect(yield* Ref.get(started)).toEqual(before)
    }),
  )

  it.effect("reads on from the last event it saw, then the result", () =>
    Effect.gen(function* () {
      const watched = yield* watchExample("run-1", 5)
      expect(watched.events.map((e) => e.type)).toEqual([
        "step_started",
        "step_completed",
        "workflow_completed",
      ])
      expect(watched.done).toBe(true)
      expect(watched.status).toBe("complete")
    }),
  )
})
