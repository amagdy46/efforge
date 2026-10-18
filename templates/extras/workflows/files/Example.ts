import { Effect, Layer, Schema } from "effect"
import { Workflow } from "effect-cf"

export class ExampleWorkflow extends Workflow.Tag<ExampleWorkflow>()("ExampleWorkflow", {
  payload: Schema.Struct({ name: Schema.String }),
  result: Schema.Struct({ message: Schema.String }),
}) {}

/**
 * A Cloudflare Workflow: each `Workflow.step` is durable, retried on failure, and not re-run once
 * it has succeeded. Bound as EXAMPLE_WORKFLOW in wrangler.jsonc and exported from `src/server.ts`.
 */
export class Example extends ExampleWorkflow.make(Layer.empty, {
  run: ({ name }) =>
    Effect.gen(function* () {
      const greeting = yield* Workflow.step(
        "greet",
        Effect.sync(() => `Hello, ${name}`),
      )
      yield* Workflow.sleep("pause", "5 seconds")
      const message = yield* Workflow.step(
        "finish",
        Effect.sync(() => `${greeting}! The workflow finished.`),
      )
      return { message }
    }),
}) {}
