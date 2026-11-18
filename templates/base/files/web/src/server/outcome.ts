import { Effect, type Layer } from "effect"
import type { AppLayer } from "./layers"
import { runtime } from "./runtime"
import { asNotConfigured } from "./settings"

/** A failure the browser can match on: the tagged error's `_tag` and its message. */
export interface Failure {
  readonly _tag: string
  readonly message: string
}

/** What a server function hands the browser: the value, or the tagged error it failed with. */
export type Outcome<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: Failure }

const failure = (error: { readonly _tag: string; readonly message: string }): Failure => {
  const missing = asNotConfigured(error)
  return missing === undefined
    ? { _tag: error._tag, message: error.message }
    : { _tag: missing._tag, message: missing.message }
}

/**
 * Runs `effect` on the app runtime for a server function. Its typed failures are logged on the
 * server and come back as data (`{ ok: false, error: { _tag, message } }`, nothing else of the
 * error), so the UI can show each one as a normal state; a missing setting comes back as
 * `NotConfigured`. Defects still reject, like `runPromise`.
 */
export const runOutcome = <A, E extends Failure, R extends Layer.Success<typeof AppLayer>>(
  effect: Effect.Effect<A, E, R>,
): Promise<Outcome<A>> =>
  runtime
    .runPromise(
      effect.pipe(
        Effect.tapError((error) => Effect.logWarning(error._tag, error)),
        Effect.match({
          onSuccess: (value): Outcome<A> => ({ ok: true, value }),
          onFailure: (error): Outcome<A> => ({ ok: false, error: failure(error) }),
        }),
      ),
    )
    .catch((error: unknown): Outcome<A> => {
      const missing = asNotConfigured(error)
      if (missing === undefined) throw error
      return { ok: false, error: { _tag: missing._tag, message: missing.message } }
    })
