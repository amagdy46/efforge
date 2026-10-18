import { Auth } from "@repo/core/Auth"
import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"
import { runtime } from "./runtime"

/** The signed-in user, or null. Route guards call this. */
export const getSession = createServerFn({ method: "GET" }).handler(() =>
  runtime.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth
      return yield* auth.currentSession
    }).pipe(Effect.catchTag("Unauthorized", () => Effect.succeed(null))),
  ),
)
