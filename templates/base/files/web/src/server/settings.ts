import { Cause, type Context, Effect, Layer } from "effect"
import { NotConfigured } from "../lib/outcome"
import { stack } from "./manifest"

/** Where `pnpm dev` reads settings from. */
const SETTINGS_FILE = stack.infra === "alchemy" ? ".env" : ".dev.vars"

export { NotConfigured }

/** `setting` is missing (or, with `problem`, unusable): `NotConfigured`, naming where to set it. */
export const notConfigured = (setting: string, problem = `${setting} is not set.`): NotConfigured =>
  new NotConfigured({
    setting,
    file: SETTINGS_FILE,
    problem,
    message: `${problem} Set ${setting} in ${SETTINGS_FILE} and restart pnpm dev.`,
  })

/** A setting's name: upper case, digits and underscores, as `.dev.vars` and `.env` write them. */
const NAME = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Z]{2,}[A-Z0-9]*)\b/

/**
 * `error` as `NotConfigured` when it is a setting a layer could not use: an Effect `ConfigError`
 * (missing, named as `at ["NAME"]`), or a layer's own `...ConfigError` or `...NotConfigured`. Such an error should name
 * the setting in a `setting` field (as `StorageConfigError` does); otherwise the first setting
 * name in its message is taken, and its message is kept as the problem.
 */
export const asNotConfigured = (error: unknown): NotConfigured | undefined => {
  if (error instanceof NotConfigured) return error
  if (typeof error !== "object" || error === null || !("_tag" in error)) return undefined
  if (!/(?:ConfigError|NotConfigured)$/.test(String(error._tag))) return undefined
  const message = "message" in error ? String(error.message) : ""
  const own = error._tag !== "ConfigError" && message !== "" ? message : undefined
  if ("setting" in error && typeof error.setting === "string")
    return notConfigured(error.setting, own)
  // an Effect ConfigError names the key as `at ["NAME"]`
  const missing = /\["([A-Za-z0-9_]+)"\]/.exec(message)?.[1]
  if (missing !== undefined) return notConfigured(missing)
  const named = NAME.exec(message)?.[1]
  return notConfigured(named ?? String(error._tag), own)
}

/**
 * `layer`, failing with `NotConfigured` when it could not start for a missing setting. The
 * runtime wraps `AppLayer` in it, so this covers every add-on's settings.
 */
export const checkSettings = <A, E, R>(
  layer: Layer.Layer<A, E, R>,
): Layer.Layer<A, E | NotConfigured, R> =>
  layer.pipe(
    Layer.catchCause((cause) => {
      const missing = asNotConfigured(Cause.squash(cause))
      const failure: Effect.Effect<Context.Context<A>, E | NotConfigured> = missing === undefined
        ? Effect.failCause(cause)
        : Effect.fail(missing)
      return Layer.effectContext(failure)
    }),
  )
