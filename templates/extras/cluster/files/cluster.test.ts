import { DurableObjectSqlClient } from "@effect/platform-cloudflare/CloudflareCluster"
import { SqliteClient } from "@effect/sql-sqlite-node"
import { expect, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { TestRunner } from "effect/cluster"
import { PersistedQueue } from "effect/persistence"
import { SqlClient } from "effect/sql"
import { WorkflowEngine } from "effect/workflow"
import {
  approveReview,
  greet,
  increment,
  InvalidCounterName,
  startReview,
  UnknownExecution,
  watchReview,
} from "../src/cluster"
import { CounterLive, GreetLive, ReviewLive } from "../src/cluster-handlers"

/*
 * The same programs and handlers as on Cloudflare, on in-memory stand-ins:
 * `TestRunner` for the Durable Objects behind entities, SQLite in memory for
 * each entity's own storage, `WorkflowEngine.layerMemory` for workflows and an
 * in-memory store for the queue. They prove the code, not Durable Objects:
 * timing (alarms, the late durable sleep) only shows under `pnpm dev`.
 */
const EntitySql = Layer.effect(DurableObjectSqlClient, Effect.service(SqlClient.SqlClient)).pipe(
  Layer.provide(SqliteClient.layer({ filename: ":memory:" })),
)

layer(CounterLive.pipe(Layer.provideMerge(TestRunner.layer), Layer.provide(EntitySql)))(
  "Counter entity",
  (it) => {
    it.effect("keeps one count per owner and name", () =>
      Effect.gen(function* () {
        yield* increment("ada", "visits")
        expect(yield* increment("ada", "visits")).toBe(2)
        expect(yield* increment("rev", "visits")).toBe(1)
        expect(yield* increment("ada", "other")).toBe(1)
      }),
    )

    it.effect("refuses a blank counter name with InvalidCounterName", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(increment("ada", "   "))
        expect(error).toBeInstanceOf(InvalidCounterName)
        expect(error instanceof InvalidCounterName && error.limit).toBe(40)
      }),
    )
  },
)

layer(ReviewLive.pipe(Layer.provideMerge(WorkflowEngine.layerMemory)))("Review workflow", (it) => {
  it.effect("waits for the approval, then publishes", () =>
    Effect.gen(function* () {
      const { run } = yield* startReview("ada", "Notes")
      expect(yield* watchReview("ada", run)).toEqual({ state: "waiting" })
      expect(yield* approveReview("ada", run)).toEqual({
        state: "done",
        result: '"Notes" drafted, approved, published',
      })
    }),
  )

  it.effect("refuses another owner's run with UnknownExecution", () =>
    Effect.gen(function* () {
      const { run } = yield* startReview("ada", "Notes")
      expect(yield* Effect.flip(watchReview("rev", run))).toBeInstanceOf(UnknownExecution)
      expect(yield* Effect.flip(approveReview("rev", run))).toBeInstanceOf(UnknownExecution)
      expect(yield* watchReview("ada", run)).toEqual({ state: "waiting" })
    }),
  )
})

const QueueTest = GreetLive.pipe(
  Layer.provideMerge(WorkflowEngine.layerMemory),
  Layer.provideMerge(PersistedQueue.layer),
  Layer.provide(PersistedQueue.layerStoreMemory),
)

// the real clock: the request polls for the worker's result
layer(QueueTest, { excludeTestServices: true })("Greet workflow and its queue", (it) => {
  it.effect("the request that offers a greeting runs the worker and returns its result", () =>
    Effect.gen(function* () {
      const { greeting } = yield* greet("ada", "Ada")
      expect(greeting).toBe("Hello, Ada. Written by the queue worker.")
    }),
  )
})
