import { Effect, type Layer } from "effect"
import { AppLayer } from "./layers"
import { checkSettings } from "./settings"

/**
 * Server functions run their Effects through here. Workers must not reuse I/O (such as a
 * Postgres socket) across requests, so unlike a `ManagedRuntime` this builds `AppLayer` for each
 * call and closes it afterwards; Hyperdrive pools the connections behind it. A missing setting
 * fails the call with `NotConfigured` (see settings.ts).
 */
export const runtime = {
  runPromise: <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof AppLayer>>): Promise<A> =>
    Effect.runPromise(Effect.provide(effect, checkSettings(AppLayer))),
}
