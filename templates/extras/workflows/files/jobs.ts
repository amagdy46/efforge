import { type JobEvent, JobError, Jobs } from "@repo/core"
import { Duration, Effect, Layer, Option } from "effect"
import { ExampleWorkflow } from "../workflows/Example"
import { WorkerEnvLive } from "./cloudflare"

const fail = (operation: string) => (cause: unknown) => new JobError({ operation, cause })

/** How long `events` waits for the first new event, then for each one after it. */
const FIRST_EVENT = Duration.seconds(5)
const NEXT_EVENT = Duration.millis(250)

const toJobEvent = (event: WorkflowInstanceEvent): JobEvent => ({
  id: event.eventId,
  type: event.type,
  step: "stepName" in event ? event.stepName : undefined,
  attempt: "attempt" in event ? event.attempt : undefined,
  error: "error" in event ? event.error.message : undefined,
  at: event.timestamp,
})

/**
 * The run's events after `after`, through `WorkflowInstance.subscribe`: waits up to FIRST_EVENT for
 * one, then takes the ones that follow quickly. `done` once the run has finished.
 */
const readEvents = (instance: WorkflowInstance, after: number) =>
  Effect.gen(function* () {
    const subscription = yield* Effect.acquireDisposable(
      Effect.tryPromise({
        try: () => instance.subscribe(after < 0 ? undefined : { cursor: after }),
        catch: fail("subscribe"),
      }),
    )
    const events: JobEvent[] = []
    while (true) {
      const next = yield* Effect.tryPromise({
        try: () => subscription.next(),
        catch: fail("events"),
      }).pipe(Effect.timeoutOption(events.length === 0 ? FIRST_EVENT : NEXT_EVENT))
      if (Option.isNone(next)) return { events, done: false }
      if (next.value.done === true) return { events, done: true }
      events.push(toJobEvent(next.value.value))
    }
  }).pipe(Effect.scoped)

const make = Effect.gen(function* () {
  // one entry per workflow; keys match `JobPayloads` in @repo/core
  const workflows = { example: yield* ExampleWorkflow }
  return Jobs.of({
    start: (job, payload) =>
      workflows[job].create(payload).pipe(
        Effect.map((instance) => ({ id: instance.id })),
        Effect.mapError(fail("start")),
      ),
    status: (job, id) =>
      workflows[job].get(id).pipe(
        Effect.flatMap((instance) => instance.status),
        Effect.map((s) => ({
          status: s.status,
          output: Option.getOrUndefined(s.output),
          error: Option.getOrUndefined(Option.map(s.error, (e) => e.message)),
        })),
        Effect.mapError(fail("status")),
      ),
    events: (job, id, after) =>
      workflows[job].get(id).pipe(
        Effect.flatMap((instance) => readEvents(instance.raw, after)),
        Effect.mapError(fail("events")),
      ),
  })
})

/** `Jobs` on Cloudflare Workflows, through the EXAMPLE_WORKFLOW binding. */
export const JobsLive = Layer.effect(Jobs, make).pipe(
  Layer.provide(ExampleWorkflow.layer({ binding: "EXAMPLE_WORKFLOW" })),
  Layer.provide(WorkerEnvLive),
)
