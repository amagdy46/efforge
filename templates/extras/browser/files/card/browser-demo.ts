import { BrowserError, BrowserUnavailable, InvalidUrl, UrlRefused, visit } from "@repo/core/browser"
import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { stack } from "./manifest"
import { runOutcome } from "./outcome"

/** What turns the browser container on for `pnpm dev`, in this project's terms. */
const turnOn =
  stack.infra === "alchemy"
    ? "Start Docker, then restart pnpm dev; Alchemy runs the container locally with Docker."
    : "Start Docker, set dev.enable_containers to true in wrangler.jsonc, then restart pnpm dev."

/** `BrowserUnavailable`, saying how to turn the container on in this project. */
const explain = (program: ReturnType<typeof visit>) =>
  program.pipe(
    Effect.catchTag("BrowserUnavailable", (error) =>
      Effect.fail(new BrowserUnavailable({ message: `${error.message} ${turnOn}` })),
    ),
  )

// #region card
const VisitInput = Schema.Struct({
  url: Schema.String.check(Schema.isMaxLength(2048)),
})

/** What `visitPage` can fail with; each reaches the browser as its class. */
const VisitErrors = [
  InvalidUrl, // not an http(s) address
  UrlRefused, // the container's URL policy refused it
  BrowserUnavailable, // no container runs here
  BrowserError, // the page or the container failed
] as const

/** Loads a page in the browser container; the URL policy runs there too. */
export const visitPage = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(VisitInput))
  .handler(({ data }) => runOutcome(explain(visit(data.url)), ...VisitErrors))
// #endregion
