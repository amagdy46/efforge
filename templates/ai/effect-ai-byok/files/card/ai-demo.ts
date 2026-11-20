import { ask, EmptyPrompt, LlmError, LlmNotConfigured } from "@repo/core/llm"
import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema, Stream } from "effect"
import { runOutcome } from "./outcome"
import { asNotConfigured } from "./settings"

/** How an `LlmError` part way through the answer travels: its fields, as JSON. */
export const LlmFailure = Schema.toCodecJson(LlmError)

/** A piece of the answer, or the `LlmError` that ended it part way through. */
export type AnswerPart =
  | { readonly text: string }
  | { readonly failure: Schema.Codec.Encoded<typeof LlmFailure> }

const AskInput = Schema.Struct({
  prompt: Schema.String.check(Schema.isMaxLength(4000)),
})

/**
 * A setting the layer could not use as `NotConfigured`, which names its file and keeps the
 * layer's reason ("is not set", "must be one of: ...").
 */
const named = (error: LlmNotConfigured) =>
  Effect.fail(error.setting === undefined ? error : (asNotConfigured(error) ?? error))

/** The answer for the browser: text as it comes, then a failure if one ends it. */
const parts = (answer: Stream.Stream<string, LlmError>) =>
  answer.pipe(
    Stream.map((text): AnswerPart => ({ text })),
    Stream.tapError((error) => Effect.logWarning(error._tag, error)),
    Stream.catch((error) =>
      Stream.succeed<AnswerPart>({ failure: Schema.encodeSync(LlmFailure)(error) }),
    ),
    Stream.toReadableStream(),
  )

// #region card
/** What `askModel` can fail with before it answers; each arrives as itself. */
export const AskModelErrors = [EmptyPrompt, LlmNotConfigured] as const

/** Asks the model; its answer streams back as it is written. */
export const askModel = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(AskInput))
  .handler(({ data }) => {
    const answer = ask(data.prompt).pipe(
      Effect.map(parts),
      Effect.catchTag("LlmNotConfigured", named),
    )
    return runOutcome(answer, ...AskModelErrors)
  })
// #endregion
