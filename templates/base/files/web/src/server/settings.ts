import { Cause, type Context, Effect, Layer } from "effect"
import { stack } from "./manifest"

/** Where `pnpm dev` reads settings from. */
const SETTINGS_FILE = stack.infra === "alchemy" ? ".env" : ".dev.vars"

/**
 * A setting a layer reads is missing or unusable, so nothing that needs the layer can run. A plain
 * `Error` (it reaches the browser intact): routes show it as a page, and cards as their "not
 * configured" state, both naming the setting and the file to put it in. `problem` says what is
 * wrong with it: not set (the default), or the layer's own reason (too short, not a URL).
 */
export class NotConfigured extends Error {
  readonly _tag = "NotConfigured"
  constructor(
    readonly setting: string,
    readonly file: string = SETTINGS_FILE,
    readonly problem: string = `${setting} is not set.`,
  ) {
    super(`${problem} Set ${setting} in ${file} and restart pnpm dev.`)
    this.name = "NotConfigured"
  }
}

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
    return new NotConfigured(error.setting, SETTINGS_FILE, own)
  // an Effect ConfigError names the key as `at ["NAME"]`
  const missing = /\["([A-Za-z0-9_]+)"\]/.exec(message)?.[1]
  if (missing !== undefined) return new NotConfigured(missing)
  const named = NAME.exec(message)?.[1]
  return new NotConfigured(named ?? String(error._tag), SETTINGS_FILE, own)
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
