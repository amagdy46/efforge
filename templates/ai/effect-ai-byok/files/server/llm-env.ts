import { type LlmProvider, Llm, LlmNotConfigured, llmProviders } from "@repo/core/llm"
import { Config, type ConfigProvider, Effect, Layer, Option, Redacted, Schema } from "effect"
import { WorkerConfig } from "effect-cf"
import { WorkerEnvLive } from "./cloudflare"
import { generateWith, type LlmSettings, streamWith } from "./llm-provider"

const decodeProvider = Schema.decodeUnknownEffect(Schema.Literals(llmProviders))

const notConfigured = (message: string, setting?: string) =>
  new LlmNotConfigured({ message, setting })

/** Reads LLM_PROVIDER, LLM_MODEL, LLM_API_KEY and LLM_BASE_URL on each call, so a missing one fails that call only. */
const loadSettings = (provider: ConfigProvider.ConfigProvider) =>
  Effect.gen(function* () {
    const required = (name: string) =>
      Config.String(name)
        .parse(provider)
        .pipe(Effect.mapError(() => notConfigured(`${name} is not set.`, name)))
    const config = yield* Effect.all({
      provider: required("LLM_PROVIDER"),
      model: required("LLM_MODEL"),
      // an empty key is no key (Alchemy binds an empty one until you set it)
      apiKey: Config.option(Config.Redacted("LLM_API_KEY"))
        .parse(provider)
        .pipe(Effect.map(Option.filter((key) => Redacted.value(key) !== "")))
        .pipe(Effect.mapError(() => notConfigured("LLM_API_KEY is not set.", "LLM_API_KEY"))),
      baseUrl: Config.option(Config.String("LLM_BASE_URL"))
        .parse(provider)
        .pipe(Effect.mapError(() => notConfigured("LLM_BASE_URL is not valid.", "LLM_BASE_URL"))),
    })
    const name: LlmProvider = yield* decodeProvider(config.provider).pipe(
      Effect.mapError(() =>
        notConfigured(`LLM_PROVIDER must be one of: ${llmProviders.join(", ")}.`),
      ),
    )
    if (name !== "ollama" && Option.isNone(config.apiKey))
      return yield* notConfigured("LLM_API_KEY is not set.", "LLM_API_KEY")
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
      streamText: (prompt) =>
        loadSettings(provider).pipe(Effect.map((settings) => streamWith(settings, prompt))),
    })
  }),
).pipe(Layer.provide(WorkerEnvLive))
