import { AsyncLocalStorage } from "node:async_hooks"
import { Cause, Effect, Exit, type Layer, Schema } from "effect"
import {
  type ErrorSchema,
  type Failure,
  failureCodec,
  type Outcome,
  type TagsOf,
  type WireCause,
} from "../lib/outcome"
import type { AppLayer } from "./layers"
import { runtime } from "./runtime"
import { asNotConfigured } from "./settings"

export type { Failure, Outcome }

/** The name of the server function being called (`name-call.ts` sets it), for its span. */
export const callNames = new AsyncLocalStorage<string>()
const currentCall = () => callNames.getStore() ?? "serverFn"

/** A typed failure as the browser should see it: a missing setting as `NotConfigured`. */
const shown = <E>(error: E) => asNotConfigured(error) ?? error

/**
 * Runs `effect` on the app runtime for a server function, as a span named after
 * the function, and returns its `Exit` encoded for the wire. List the schemas
 * of the tagged errors it can fail with (`Schema.TaggedError` classes): they
 * reach the browser as those classes, with their fields, through
 * `useServerCall(fn, ...errors)`, which must list the same ones (the types
 * check it). Declare the list once, beside the server function, and spread it
 * on both sides. An error not listed arrives as its tag and
 * message. Typed failures are logged here; a defect or a runtime that cannot
 * start (other than a missing setting, which is `NotConfigured`) rejects the
 * call, a 500.
 */
export function runOutcome<
  A,
  E extends Failure,
  R extends Layer.Success<typeof AppLayer>,
  const S extends ReadonlyArray<ErrorSchema> = [],
>(effect: Effect.Effect<A, E, R>, ...errors: S): Promise<Outcome<A, WireCause, TagsOf<S>>> {
  const listed: ReadonlyArray<ErrorSchema> = errors
  const encode = Schema.encodeSync(failureCodec(listed))
  return runtime
    .runPromise(
      effect.pipe(
        Effect.tapError((error) => Effect.logWarning(error._tag, error)),
        Effect.withSpan(currentCall()),
        Effect.exit,
      ),
    )
    .then((exit) => {
      if (Exit.isSuccess(exit)) return { _tag: "Success" as const, value: exit.value }
      // only typed failures cross the wire; a defect or an interruption is a bug: reject
      const failures = exit.cause.reasons.filter(Cause.isFailReason)
      if (failures.length === 0) throw Cause.squash(exit.cause)
      const cause = Cause.fromReasons(failures.map((r) => Cause.makeFailReason(shown(r.error))))
      return { _tag: "Failure" as const, cause: encode(cause) }
    })
    .catch((error: unknown) => {
      const missing = asNotConfigured(error)
      if (missing === undefined) throw error
      return { _tag: "Failure" as const, cause: encode(Cause.fail(missing)) }
    })
}
