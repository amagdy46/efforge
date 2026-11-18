import { createServerFn } from "@tanstack/react-start"
import { Clock, Effect } from "effect"
import { runOutcome } from "./outcome"
import { requireSession } from "./require-session"

// #region card
/**
 * Only signed-in users get here: `requireSession` runs
 * `Auth.currentSession` first and rejects the call on `Unauthorized`.
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
