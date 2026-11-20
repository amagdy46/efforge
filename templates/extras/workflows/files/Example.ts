import { Data, Effect, Layer, Schema } from "effect"
import { Workflow } from "effect-cf"

/** A typed failure: the name is unusable, so retrying cannot help. */
export class InvalidName extends Data.TaggedError("InvalidName")<{ readonly input: string }> {}

/** The first attempt was asked to fail (`failFirstAttempt`), so the step is retried. */
export class FirstAttemptFailed extends Data.TaggedError("FirstAttemptFailed")<{
  readonly message: string
}> {}

export class ExampleWorkflow extends Workflow.Tag<ExampleWorkflow>()("ExampleWorkflow", {
  payload: Schema.Struct({ name: Schema.String, failFirstAttempt: Schema.Boolean }),
  result: Schema.Struct({ message: Schema.String }),
}) {}

/** The `greet` step: fails its first attempt when asked to, so the retry shows on the card. */
const greet = (name: string, failFirstAttempt: boolean) =>
  Effect.gen(function* () {
    // a blank name ends the run at once: WorkflowStepNonRetryableError is never retried
    if (name.trim() === "")
      return yield* new Workflow.WorkflowStepNonRetryableError({
        cause: new InvalidName({ input: name }),
      })
    const { attempt } = yield* Workflow.WorkflowStepContext
    if (failFirstAttempt && attempt === 1)
      return yield* new FirstAttemptFailed({ message: "Failed on purpose, to show a retry." })
    return `Hello, ${name.trim()}`
  })

/**
 * A Cloudflare Workflow: each `Workflow.step` is durable, retried on failure, and not re-run once
 * it has succeeded. Bound as EXAMPLE_WORKFLOW and exported from `src/server.ts`.
 */
export class Example extends ExampleWorkflow.make(Layer.empty, {
  // #region card
  run: ({ name, failFirstAttempt }) =>
    Effect.gen(function* () {
      // retried up to 3 times, 2s then 4s then 8s apart, before the run fails
      const hello = yield* Workflow.step("greet", greet(name, failFirstAttempt), {
        retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
        timeout: "30 seconds",
      })
      // durable: the run sleeps without holding a Worker
      yield* Workflow.sleep("pause", "5 seconds")
      const message = yield* Workflow.step(
        "finish",
        Effect.sync(() => `${hello}! The workflow finished.`),
      )
      return { message }
    }),
  // #endregion
}) {}
