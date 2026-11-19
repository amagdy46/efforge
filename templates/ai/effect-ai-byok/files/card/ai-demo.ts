import { ask, type LlmError, type LlmNotConfigured } from "@repo/core/llm"
import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema, Stream } from "effect"
import { type Failure, runOutcome } from "./outcome"
import { NotConfigured } from "./settings"

/** A piece of the answer, or how the answer failed part way through. */
export type AnswerPart = { readonly text: string } | { readonly failure: Failure }

const AskInput = Schema.Struct({
  prompt: Schema.String.check(Schema.isMaxLength(4000)),
})

/** A missing environment variable as `NotConfigured`, which names its file. */
const named = (error: LlmNotConfigured) =>
  Effect.fail(error.setting === undefined ? error : new NotConfigured(error.setting))

/** The answer for the browser: text as it comes, then a failure if one ends it. */
const parts = (answer: Stream.Stream<string, LlmError>) =>
  answer.pipe(
    Stream.map((text): AnswerPart => ({ text })),
    Stream.tapError((error) => Effect.logWarning(error._tag, error)),
    Stream.catch((error) =>
      Stream.succeed<AnswerPart>({ failure: { _tag: error._tag, message: error.message } }),
    ),
    Stream.toReadableStream(),
  )

// #region card
/** Asks the model; its answer streams back as it is written. */
export const askModel = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(AskInput))
  .handler(({ data }) => {
    const answer = ask(data.prompt).pipe(Effect.map(parts))
    return runOutcome(answer.pipe(Effect.catchTag("LlmNotConfigured", named)))
  })
// #endregion
