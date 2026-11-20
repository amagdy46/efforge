import { createMiddleware } from "@tanstack/react-start"
import { callNames } from "./outcome"

/**
 * Runs before every server function (`functionMiddleware` in start.ts): it
 * names the span `runOutcome` opens for the call after the function,
 * `serverFn.greet`, so a trace reads by name once a tracer is set.
 */
export const nameCall = createMiddleware({ type: "function" }).server(({ next, serverFnMeta }) =>
  callNames.run(`serverFn.${serverFnMeta.name}`, () => next()),
)
