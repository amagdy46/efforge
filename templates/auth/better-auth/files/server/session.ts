import { sessionOrNull } from "@repo/core/Auth"
import { createServerFn } from "@tanstack/react-start"
import { runtime } from "./runtime"

/** The signed-in user, or null. Route guards call this. */
export const getSession = createServerFn({ method: "GET" }).handler(() =>
  runtime.runPromise(sessionOrNull),
)
