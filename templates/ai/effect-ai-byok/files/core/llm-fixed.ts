import { Context, Effect, Layer, Ref, Stream } from "effect"
import { Llm, LlmNotConfigured } from "../src/llm"

/** Every prompt `LlmFixed` was sent, in order. */
export class Prompts extends Context.Service<Prompts, Ref.Ref<ReadonlyArray<string>>>()(
  "test/Prompts",
) {}

/**
 * `Llm` without a provider: answers every prompt with `answer`, streamed a word at a time, and
 * records the prompts in `Prompts`. Use it in place of `LlmLive` to test code that calls a model.
 */
export const LlmFixed = (answer: string) =>
  Layer.effect(
    Llm,
    Effect.gen(function* () {
      const prompts = yield* Prompts
      const record = (prompt: string) => Ref.update(prompts, (all) => [...all, prompt])
      return Llm.of({
        generateText: (prompt) => record(prompt).pipe(Effect.as(answer)),
        streamText: (prompt) =>
          record(prompt).pipe(Effect.as(Stream.fromIterable(answer.split(/(?<= )/)))),
      })
    }),
  ).pipe(Layer.provideMerge(Layer.effect(Prompts, Ref.make<ReadonlyArray<string>>([]))))

/** `Llm` with no model configured: every call fails with `LlmNotConfigured` for LLM_API_KEY. */
export const LlmUnconfigured = Layer.succeed(
  Llm,
  Llm.of({
    generateText: () =>
      Effect.fail(
        new LlmNotConfigured({ message: "LLM_API_KEY is not set.", setting: "LLM_API_KEY" }),
      ),
    streamText: () =>
      Effect.fail(
        new LlmNotConfigured({ message: "LLM_API_KEY is not set.", setting: "LLM_API_KEY" }),
      ),
  }),
)
