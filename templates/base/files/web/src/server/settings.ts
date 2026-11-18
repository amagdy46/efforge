import { Cause, type Context, Effect, Layer } from "effect"
import { stack } from "./manifest"

/** Where `pnpm dev` reads settings from. */
const SETTINGS_FILE = stack.infra === "alchemy" ? ".env" : ".dev.vars"

/**
 * A setting a layer reads is missing, so nothing that needs the layer can run. A plain `Error`
 * (it reaches the browser intact): routes show it as a page, and cards as their "not configured"
 * state, both naming the setting and the file to put it in.
 */
export class NotConfigured extends Error {
  readonly _tag = "NotConfigured"
  constructor(
    readonly setting: string,
    readonly file: string = SETTINGS_FILE,
  ) {
    super(`${setting} is not set. Add it to ${file} and restart pnpm dev.`)
    this.name = "NotConfigured"
  }
}

/** `error` as `NotConfigured` when it is a missing setting (an Effect `ConfigError`). */
export const asNotConfigured = (error: unknown): NotConfigured | undefined => {
  if (error instanceof NotConfigured) return error
  if (typeof error !== "object" || error === null || !("_tag" in error)) return undefined
  if (!String(error._tag).endsWith("ConfigError")) return undefined
  const message = "message" in error ? String(error.message) : ""
  // a ConfigError names the key as `at ["NAME"]`
  return new NotConfigured(/\["([A-Za-z0-9_]+)"\]/.exec(message)?.[1] ?? "A setting")
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
