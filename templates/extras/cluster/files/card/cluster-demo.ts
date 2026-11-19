import {
  approveReview,
  ClusterError,
  greet,
  increment,
  InvalidCounterName,
  MAX_COUNTER_NAME,
  startReview,
  UnknownExecution,
  watchReview,
} from "@repo/core/cluster"
import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { runOutcome } from "./outcome"
import { currentOwner } from "./owner"

const Text = Schema.String.check(Schema.isMaxLength(100))
const RunInput = Schema.Struct({
  run: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
})

// #region card
const CounterInput = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(MAX_COUNTER_NAME)),
})

/** One more on the caller's counter; it lives in its own Durable Object. */
export const incrementCounter = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(CounterInput))
  .handler(({ data }) => {
    const program = Effect.flatMap(currentOwner, (owner) =>
      increment(owner, data.name),
    )
    return runOutcome(program, InvalidCounterName, ClusterError)
  })
// #endregion

/** Starts a review run that belongs to the caller. */
export const startReviewRun = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ title: Text })))
  .handler(({ data }) =>
    runOutcome(
      Effect.flatMap(currentOwner, (owner) => startReview(owner, data.title)),
      ClusterError,
    ),
  )

/** Where the caller's run is. */
export const watchReviewRun = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(RunInput))
  .handler(({ data }) =>
    runOutcome(
      Effect.flatMap(currentOwner, (owner) => watchReview(owner, data.run)),
      UnknownExecution,
      ClusterError,
    ),
  )

/** Approves the caller's run; the workflow wakes and publishes. */
export const approveReviewRun = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(RunInput))
  .handler(({ data }) =>
    runOutcome(
      Effect.flatMap(currentOwner, (owner) => approveReview(owner, data.run)),
      UnknownExecution,
      ClusterError,
    ),
  )

/** Offers a greeting to the queue and runs the worker in this request. */
export const sendGreeting = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ name: Text })))
  .handler(({ data }) =>
    runOutcome(
      Effect.flatMap(currentOwner, (owner) => greet(owner, data.name)),
      ClusterError,
    ),
  )
