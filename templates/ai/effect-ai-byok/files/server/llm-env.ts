import { type LlmProvider, Llm, LlmNotConfigured, llmProviders } from "@repo/core/llm"
import { Config, type ConfigProvider, Effect, Layer, Option, Schema } from "effect"
import { WorkerConfig } from "effect-cf"
import { WorkerEnvLive } from "./cloudflare"
import { generateWith, type LlmSettings } from "./llm-provider"

const decodeProvider = Schema.decodeUnknownEffect(Schema.Literals(llmProviders))

const notConfigured = (message: string) => new LlmNotConfigured({ message })

/** Reads LLM_PROVIDER, LLM_MODEL, LLM_API_KEY and LLM_BASE_URL on each call, so a missing one fails that call only. */
const loadSettings = (provider: ConfigProvider.ConfigProvider) =>
  Effect.gen(function* () {
    const config = yield* Effect.all({
      provider: Config.String("LLM_PROVIDER").parse(provider),
      model: Config.String("LLM_MODEL").parse(provider),
      apiKey: Config.option(Config.Redacted("LLM_API_KEY")).parse(provider),
      baseUrl: Config.option(Config.String("LLM_BASE_URL")).parse(provider),
    }).pipe(
      Effect.mapError(() => notConfigured("Set LLM_PROVIDER and LLM_MODEL (and LLM_API_KEY).")),
    )
    const name: LlmProvider = yield* decodeProvider(config.provider).pipe(
      Effect.mapError(() =>
        notConfigured(`LLM_PROVIDER must be one of: ${llmProviders.join(", ")}.`),
      ),
    )
    if (name !== "ollama" && Option.isNone(config.apiKey))
      return yield* notConfigured("LLM_API_KEY is not set.")
    const settings: LlmSettings = {
      provider: name,
      model: config.model,
      apiKey: Option.getOrUndefined(config.apiKey),
      baseUrl: Option.getOrUndefined(Option.filter(config.baseUrl, (url) => url !== "")),
    }
    return settings
  })

/** `Llm` configured from the environment: LLM_PROVIDER, LLM_MODEL, LLM_API_KEY, optional LLM_BASE_URL. */
export const LlmLive = Layer.effect(
  Llm,
  Effect.gen(function* () {
    const provider = yield* WorkerConfig.provider
    return Llm.of({
      generateText: (prompt) =>
        loadSettings(provider).pipe(Effect.flatMap((settings) => generateWith(settings, prompt))),
    })
  }),
).pipe(Layer.provide(WorkerEnvLive))
