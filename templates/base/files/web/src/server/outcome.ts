import { Effect, type Layer } from "effect"
import type { AppLayer } from "./layers"
import { runtime } from "./runtime"

/** A failure the browser can match on: the tagged error's `_tag` and its message. */
export interface Failure {
  readonly _tag: string
  readonly message: string
}

/** What a server function hands the browser: the value, or the tagged error it failed with. */
export type Outcome<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: Failure }

/** A layer could not start because a setting is missing, so nothing that needs it can run. */
const notConfigured = (error: unknown): Failure | undefined => {
  if (typeof error !== "object" || error === null || !("_tag" in error)) return undefined
  const tag = String(error._tag)
  if (!tag.endsWith("ConfigError")) return undefined
  const message = "message" in error ? String(error.message) : tag
  // Config errors name the key as `at ["NAME"]`
  const key = /\["([A-Z0-9_]+)"\]/.exec(message)?.[1]
  return {
    _tag: "NotConfigured",
    message: key === undefined ? message : `${key} is not set.`,
  }
}

/**
 * Runs `effect` on the app runtime for a server function. Its typed failures come back as data
 * (`{ ok: false, error: { _tag, message } }`) so the UI can show each one as a normal state, and
 * a missing setting comes back as `NotConfigured`. Defects still reject, like `runPromise`.
 */
export const runOutcome = <A, E extends Failure, R extends Layer.Success<typeof AppLayer>>(
  effect: Effect.Effect<A, E, R>,
): Promise<Outcome<A>> =>
  runtime
    .runPromise(
      effect.pipe(
        Effect.match({
          onSuccess: (value): Outcome<A> => ({ ok: true, value }),
          onFailure: (error): Outcome<A> => ({
            ok: false,
            error: { _tag: error._tag, message: error.message },
          }),
        }),
      ),
    )
    .catch((error: unknown) => {
      const failure = notConfigured(error)
      if (failure === undefined) throw error
      return { ok: false, error: failure }
    })
