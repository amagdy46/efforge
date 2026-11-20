import { Cause, type Context, Effect, Layer } from "effect"
import { NotConfigured } from "../lib/outcome"
import { stack } from "./manifest"

/** Where `pnpm dev` reads settings from. */
const SETTINGS_FILE = stack.infra === "alchemy" ? ".env" : ".dev.vars"

export { NotConfigured }

/**
 * `setting` is missing (or, with `problem`, unusable): `NotConfigured`. Under `pnpm dev` it says
 * what is wrong and the file to set it in. Outside development it names the setting and nothing
 * else, since anyone can read it there; `checkSettings` logs the reason on the server.
 */
export const notConfigured = (setting: string, problem = `${setting} is not set.`): NotConfigured =>
  import.meta.env.DEV
    ? new NotConfigured({
        setting,
        file: SETTINGS_FILE,
        problem,
        message: `${problem} Set ${setting} in ${SETTINGS_FILE} and restart pnpm dev.`,
      })
    : new NotConfigured({
        setting,
        problem: `${setting} is not configured.`,
        message: `${setting} is not configured.`,
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
  const found = settingOf(error)
  return found === undefined ? undefined : notConfigured(found.setting, found.problem)
}

/** The setting a configuration error is about, and the layer's own reason when it gave one. */
const settingOf = (error: unknown): { setting: string; problem?: string } | undefined => {
  if (typeof error !== "object" || error === null || !("_tag" in error)) return undefined
  if (!/(?:ConfigError|NotConfigured)$/.test(String(error._tag))) return undefined
  const message = "message" in error ? String(error.message) : ""
  const own = error._tag !== "ConfigError" && message !== "" ? message : undefined
  const reason = own === undefined ? {} : { problem: own }
  if ("setting" in error && typeof error.setting === "string")
    return { setting: error.setting, ...reason }
  // an Effect ConfigError names the key as `at ["NAME"]`
  const missing = /\["([A-Za-z0-9_]+)"\]/.exec(message)?.[1]
  if (missing !== undefined) return { setting: missing }
  const named = NAME.exec(message)?.[1]
  return { setting: named ?? String(error._tag), ...reason }
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
      const error = Cause.squash(cause)
      const missing = asNotConfigured(error)
      const found = settingOf(error)
      // outside development the answer only names the setting: the reason goes to the log
      const logged =
        found === undefined || import.meta.env.DEV
          ? Effect.void
          : Effect.logError(
              `${found.problem ?? `${found.setting} is not set.`} Set ${found.setting} as a secret or variable of the Worker.`,
            )
      const failure: Effect.Effect<Context.Context<A>, E | NotConfigured> = missing === undefined
        ? Effect.failCause(cause)
        : Effect.andThen(logged, Effect.fail(missing))
      return Layer.effectContext(failure)
    }),
  )
