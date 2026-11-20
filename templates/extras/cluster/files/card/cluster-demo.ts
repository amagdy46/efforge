import { approveReview, greet, increment, startReview, watchReview } from "@repo/core/cluster"
import {
  ClusterError,
  InvalidCounterName,
  MAX_COUNTER_NAME,
  UnknownExecution,
} from "@repo/core/cluster-errors"
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

/** What `incrementCounter` can fail with; the card spreads the same list. */
export const IncrementCounterErrors = [
  InvalidCounterName, // blank, or longer than MAX_COUNTER_NAME
  ClusterError, // reaching the entity failed
] as const

/** One more on the caller's counter; it lives in its own Durable Object. */
export const incrementCounter = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(CounterInput))
  .handler(({ data }) => {
    const add = (owner: string) => increment(owner, data.name)
    const program = Effect.flatMap(currentOwner, add)
    return runOutcome(program, ...IncrementCounterErrors)
  })
// #endregion

export const StartReviewRunErrors = [ClusterError] as const

/** Starts a review run that belongs to the caller. */
export const startReviewRun = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ title: Text })))
  .handler(({ data }) => {
    const start = (owner: string) => startReview(owner, data.title)
    const program = Effect.flatMap(currentOwner, start)
    return runOutcome(program, ...StartReviewRunErrors)
  })

export const WatchReviewRunErrors = [UnknownExecution, ClusterError] as const

/** Where the caller's run is. */
export const watchReviewRun = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(RunInput))
  .handler(({ data }) => {
    const watch = (owner: string) => watchReview(owner, data.run)
    const program = Effect.flatMap(currentOwner, watch)
    return runOutcome(program, ...WatchReviewRunErrors)
  })

export const ApproveReviewRunErrors = [UnknownExecution, ClusterError] as const

/** Approves the caller's run; the workflow wakes and publishes. */
export const approveReviewRun = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(RunInput))
  .handler(({ data }) => {
    const approve = (owner: string) => approveReview(owner, data.run)
    const program = Effect.flatMap(currentOwner, approve)
    return runOutcome(program, ...ApproveReviewRunErrors)
  })

export const SendGreetingErrors = [ClusterError] as const

/** Offers a greeting to the queue and runs the worker in this request. */
export const sendGreeting = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ name: Text })))
  .handler(({ data }) => {
    const offer = (owner: string) => greet(owner, data.name)
    const program = Effect.flatMap(currentOwner, offer)
    return runOutcome(program, ...SendGreetingErrors)
  })
