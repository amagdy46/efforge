import { expect, layer } from "@effect/vitest"
import { Effect, Ref, Stream } from "effect"
import { ask, EmptyPrompt, LlmNotConfigured } from "../src/llm"
import { LlmFixed, LlmUnconfigured, Prompts } from "./llm-fixed"

layer(LlmFixed("An Effect layer builds a service."))("ask", (it) => {
  it.effect("streams the answer to the trimmed prompt", () =>
    Effect.gen(function* () {
      const answer = yield* ask("  What is a layer? ")
      const pieces = yield* Stream.runCollect(answer)
      expect(pieces.length).toBeGreaterThan(1)
      expect(pieces.join("")).toBe("An Effect layer builds a service.")
      expect((yield* Ref.get(yield* Prompts)).at(-1)).toBe("What is a layer?")
    }),
  )

  it.effect("refuses a blank prompt with EmptyPrompt and never calls the model", () =>
    Effect.gen(function* () {
      const prompts = yield* Prompts
      const before = yield* Ref.get(prompts)
      const error = yield* Effect.flip(ask("   "))
      expect(error).toBeInstanceOf(EmptyPrompt)
      expect(yield* Ref.get(prompts)).toEqual(before)
    }),
  )
})

layer(LlmUnconfigured)("ask without a model", (it) => {
  it.effect("fails with LlmNotConfigured, naming the setting, before streaming", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(ask("hello"))
      expect(error).toBeInstanceOf(LlmNotConfigured)
      expect(error).toMatchObject({ setting: "LLM_API_KEY" })
    }),
  )
})
