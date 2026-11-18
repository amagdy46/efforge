import { createServerFn } from "@tanstack/react-start"
import { Clock, Effect } from "effect"
import { runOutcome } from "./outcome"
import { requireSession } from "./require-session"

// #region card
/**
 * A server function only signed-in users can call: the `requireSession` middleware runs
 * `Auth.currentSession` first and rejects the call when it fails with `Unauthorized`.
 */
export const whoAmI = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(({ context }) =>
    runOutcome(
      Effect.gen(function* () {
        const { userId, email } = context.session
        yield* Effect.log(`whoAmI: ${email}`)
        return { userId, email, checkedAt: yield* Clock.currentTimeMillis }
      }),
    ),
  )
// #endregion
