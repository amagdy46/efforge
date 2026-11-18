import { Context, Effect, Layer, Ref } from "effect"
import { type JobEvent, type JobPayloads, Jobs } from "../src/jobs"

/** Every payload `JobsInMemory` was asked to start, in order. */
export class Started extends Context.Service<
  Started,
  Ref.Ref<ReadonlyArray<JobPayloads["example"]>>
>()("test/Started") {}

const event = (id: number, type: string, step?: string): JobEvent => ({
  id,
  type,
  step,
  attempt: type.startsWith("attempt") ? 1 : undefined,
  error: undefined,
  at: id * 1000,
})

/** The events of a run of the example workflow that went through without a retry. */
export const exampleEvents: ReadonlyArray<JobEvent> = [
  event(1, "workflow_started"),
  event(2, "step_started", "greet"),
  event(3, "step_completed", "greet"),
  event(4, "sleep_started", "pause"),
  event(5, "sleep_completed", "pause"),
  event(6, "step_started", "finish"),
  event(7, "step_completed", "finish"),
  event(8, "workflow_completed"),
]

/**
 * `Jobs` without Cloudflare: `start` records the payload in `Started`, and every run has already
 * finished with `exampleEvents`. Use it in place of `JobsLive` to test code that starts jobs.
 */
export const JobsInMemory = Layer.effect(
  Jobs,
  Effect.gen(function* () {
    const started = yield* Started
    return Jobs.of({
      start: (_job, payload) =>
        Ref.modify(started, (all) => [{ id: `run-${all.length + 1}` }, [...all, payload]]),
      status: () =>
        Effect.succeed({
          status: "complete",
          output: { message: "Hello, Ada! The workflow finished." },
          error: undefined,
        }),
      events: (_job, _id, after) =>
        Effect.succeed({ events: exampleEvents.filter((e) => e.id > after), done: true }),
    })
  }),
).pipe(
  Layer.provideMerge(Layer.effect(Started, Ref.make<ReadonlyArray<JobPayloads["example"]>>([]))),
)
