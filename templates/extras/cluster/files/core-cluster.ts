import { Duration, Effect, Fiber, Option, Schedule, Schema } from "effect"
import { ClusterSchema, Entity } from "effect/cluster"
import { Rpc } from "effect/rpc"
import { DurableDeferred, DurableQueue, Workflow } from "effect/workflow"
import {
  ClusterError,
  InvalidCounterName,
  MAX_COUNTER_NAME,
  type ReviewState,
  UnknownExecution,
} from "./cluster-errors"

export * from "./cluster-errors"

/*
 * Effect Cluster on Cloudflare Durable Objects (experimental): one entity, one
 * workflow and one durable queue. The definitions are plain Effect; the
 * handlers are in cluster-handlers.ts, the layer in apps/web/src/server/cluster.ts.
 * Nothing here imports `cloudflare:workers`, so the tests run in Node.
 */

/** One counter per id; each id is its own Durable Object, with its own SQLite. */
export const Counter = Entity.make("Counter", [
  Rpc.make("Increment", {
    payload: { by: Schema.Number },
    success: Schema.Number,
  }).annotate(ClusterSchema.Persisted, true),
  Rpc.make("Get", { success: Schema.Number }),
])

/** What a reviewer answers; the workflow waits for it, durably. */
export const Approval = DurableDeferred.make("Approval", { success: Schema.String })

/** Drafts, waits for an approval, publishes. One run per `owner` and `run`. */
export const Review = Workflow.make("Review", {
  payload: { owner: Schema.String, run: Schema.String, title: Schema.String },
  success: Schema.String,
  idempotencyKey: ({ owner, run }) => `${owner}/${run}`,
})

/** Greetings to write. The workflow below offers one and waits for a worker. */
export const GreetingQueue = DurableQueue.make({
  name: "GreetingQueue",
  payload: { run: Schema.String, name: Schema.String },
  success: Schema.String,
  idempotencyKey: ({ run }) => run,
})

/** Offers a greeting to the queue and returns what the worker wrote. */
export const Greet = Workflow.make("Greet", {
  payload: { owner: Schema.String, run: Schema.String, name: Schema.String },
  success: Schema.String,
  idempotencyKey: ({ owner, run }) => `${owner}/${run}`,
})

/** The queue's worker: the job each item runs. */
export const writeGreeting = (item: { readonly name: string }) =>
  Effect.succeed(`Hello, ${item.name}. Written by the queue worker.`)

/**
 * A key for `owner` in ids that are visible: a hash, so the user id is not
 * shown. Counters and runs are keyed by it, so they are the owner's own.
 */
export const ownerKey = (owner: string): Effect.Effect<string> =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(owner))).pipe(
    Effect.map((digest) =>
      [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 32),
    ),
  )

const failed = (operation: string) => (cause: unknown) => new ClusterError({ operation, cause })

const reviewId = (owner: string, run: string) =>
  Effect.flatMap(ownerKey(owner), (key) => Review.executionId({ owner: key, run, title: "" }))

// #region card
/** Adds one to `owner`'s counter `name`, in that counter's Durable Object. */
export const increment = (owner: string, name: string) =>
  Effect.gen(function* () {
    const trimmed = name.trim()
    if (trimmed === "" || trimmed.length > MAX_COUNTER_NAME)
      return yield* new InvalidCounterName({
        message: `A counter name is 1 to ${MAX_COUNTER_NAME} characters.`,
        limit: MAX_COUNTER_NAME,
      })
    const id = `${yield* ownerKey(owner)}/${trimmed}`
    const counter = (yield* Counter.client)(id)
    const added = counter.Increment({ by: 1 })
    return yield* Effect.mapError(added, failed("Counter.Increment"))
  })
// #endregion

/** Starts a review for `owner`; returns at once with the run id. */
export const startReview = (owner: string, title: string) =>
  Effect.gen(function* () {
    const run = crypto.randomUUID()
    const key = yield* ownerKey(owner)
    yield* Review.execute({ owner: key, run, title: title.trim() || "Untitled" }, { discard: true })
    return { run }
  })

/** Where `owner`'s run is: waiting for approval, done, or failed. */
export const watchReview = (owner: string, run: string) =>
  Effect.gen(function* () {
    const result = yield* Review.poll(yield* reviewId(owner, run))
    if (Option.isNone(result))
      return yield* new UnknownExecution({ message: "No run of yours has this id." })
    const value = result.value
    if (value._tag === "Suspended") return { state: "waiting" } satisfies ReviewState
    return value.exit._tag === "Success"
      ? ({ state: "done", result: value.exit.value } satisfies ReviewState)
      : ({
          state: "failed",
          message: "The run failed; the server log has why.",
        } satisfies ReviewState)
  })

/** Approves `owner`'s run: the workflow wakes and finishes. */
export const approveReview = (owner: string, run: string) =>
  Effect.gen(function* () {
    yield* watchReview(owner, run)
    const executionId = yield* reviewId(owner, run)
    const token = DurableDeferred.tokenFromExecutionId(Approval, {
      workflow: Review,
      executionId,
    })
    yield* DurableDeferred.succeed(Approval, { token, value: "approved" })
    return yield* watchReview(owner, run)
  })

/** How long the request that offers a greeting runs the worker before it answers. */
export const WORKER_BUDGET = Duration.seconds(10)

/**
 * Offers a greeting and runs the queue's worker in this request until the
 * greeting is written, for at most `WORKER_BUDGET`. Nothing runs a worker in
 * the background on Workers, so the request that offers drains the queue: it
 * takes any waiting item, oldest first, whoever offered it.
 */
export const greet = (owner: string, name: string) =>
  Effect.gen(function* () {
    const started = Date.now()
    const key = yield* ownerKey(owner)
    const payload = { owner: key, run: crypto.randomUUID(), name: name.trim() || "friend" }
    const executionId = yield* Greet.execute(payload, { discard: true })
    const worker = yield* Effect.forkChild(DurableQueue.makeWorker(GreetingQueue, writeGreeting))
    const written = yield* Greet.poll(executionId).pipe(
      Effect.repeat({
        schedule: Schedule.spaced("50 millis"),
        until: (result) => Option.isSome(result) && result.value._tag === "Complete",
      }),
      Effect.timeoutOption(WORKER_BUDGET),
    )
    yield* Fiber.interrupt(worker)
    const ms = Date.now() - started
    const result = Option.flatten(written)
    if (Option.isNone(result) || result.value._tag !== "Complete")
      return { greeting: undefined, ms }
    const exit = result.value.exit
    return exit._tag === "Success"
      ? { greeting: exit.value, ms }
      : yield* new ClusterError({ operation: "Greet", cause: exit.cause })
  })
