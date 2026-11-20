import { JobError, MissingName, startExample, UnknownRun, watchExample } from "@repo/core/jobs"
import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { runOutcome } from "./outcome"
import { currentOwner } from "./owner"

const WatchInput = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  after: Schema.Int,
})

// #region card
const StartInput = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(100)),
  failFirstAttempt: Schema.Boolean,
})

/** What `startWorkflow` can fail with; each arrives as itself. */
export const StartWorkflowErrors = [MissingName, JobError] as const

/** Starts a run that belongs to the caller. */
export const startWorkflow = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(StartInput))
  .handler(({ data }) =>
    runOutcome(
      Effect.gen(function* () {
        const owner = yield* currentOwner
        return yield* startExample(owner, data)
      }),
      ...StartWorkflowErrors,
    ),
  )
// #endregion

/** What `watchWorkflow` can fail with: a run that is not the caller's is `UnknownRun`. */
export const WatchWorkflowErrors = [UnknownRun, JobError] as const

/** The caller's run's new events and its status; the output travels as JSON text. */
export const watchWorkflow = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(WatchInput))
  .handler(({ data }) =>
    runOutcome(
      Effect.flatMap(currentOwner, (owner) => watchExample(owner, data.id, data.after)).pipe(
        Effect.map((run) => ({
          events: run.events,
          done: run.done,
          status: run.status,
          error: run.error,
          outputJson: JSON.stringify(run.output ?? null),
        })),
      ),
      ...WatchWorkflowErrors,
    ),
  )
