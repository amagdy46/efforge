import { Context, Effect, Schema, type Stream } from "effect"
import { ServerOnly } from "./server-only"

/** Providers `makeLlmLayer` can talk to. Ollama goes through the OpenAI-compatible client. */
export const llmProviders = ["anthropic", "openai", "openrouter", "ollama"] as const
export type LlmProvider = (typeof llmProviders)[number]

/** A provider request, or the storage around it, failed; `cause` stays on the server. */
export class LlmError extends Schema.TaggedError<LlmError, { readonly brand: unique symbol }>()(
  "LlmError",
  { operation: Schema.String, cause: ServerOnly },
) {
  override get message(): string {
    const cause = this.cause instanceof Error ? `: ${this.cause.message}` : ""
    return `LLM ${this.operation} failed${cause}`
  }
}

/** There is no usable model configuration for this call (no key set, or no organization selected). */
export class LlmNotConfigured extends Schema.TaggedError<
  LlmNotConfigured,
  { readonly brand: unique symbol }
>()("LlmNotConfigured", {
  message: Schema.String,
  /** The environment variable to set, when that is what is missing */
  setting: Schema.optional(Schema.String),
}) {}

/** There is nothing to send: the prompt is blank. */
export class EmptyPrompt extends Schema.TaggedError<
  EmptyPrompt,
  { readonly brand: unique symbol }
>()("EmptyPrompt", { message: Schema.String }) {}

/**
 * Text generation. The implementation in `apps/web/src/server/llm.ts` decides where the provider,
 * model and key come from; app code only calls `generateText`.
 */
export class Llm extends Context.Service<
  Llm,
  {
    readonly generateText: (prompt: string) => Effect.Effect<string, LlmError | LlmNotConfigured>
    /** The answer as it is written. Fails before streaming when no model is configured. */
    readonly streamText: (
      prompt: string,
    ) => Effect.Effect<Stream.Stream<string, LlmError>, LlmNotConfigured>
  }
>()("@repo/core/Llm") {}

// #region card
/** Streams the model's answer to `prompt`, a piece of text at a time. */
export const ask = (prompt: string) =>
  Effect.gen(function* () {
    const trimmed = prompt.trim()
    if (trimmed === "")
      return yield* new EmptyPrompt({
        message: "Ask the model something.",
      })
    const llm = yield* Llm
    // LlmNotConfigured comes back here, before anything streams
    return yield* llm.streamText(trimmed)
  })
// #endregion
