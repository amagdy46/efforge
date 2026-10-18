import { Jobs } from "@repo/core"
import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"
import { runtime } from "./runtime"

/** Starts the example workflow; returns its instance id. */
export const startExampleJob = createServerFn({ method: "POST" })
  .validator((input: { name: string }) => input)
  .handler(({ data }) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const jobs = yield* Jobs
        return yield* jobs.start("example", { name: data.name })
      }),
    ),
  )

export const getExampleJobStatus = createServerFn({ method: "GET" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const jobs = yield* Jobs
        const { status, output, error } = yield* jobs.status("example", data.id)
        // server function results must be serializable, so the output travels as JSON text
        return { status, error, outputJson: JSON.stringify(output ?? null) }
      }),
    ),
  )
