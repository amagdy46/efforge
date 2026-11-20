import { greet as greetProgram, InvalidName } from "@repo/core/greeting"
import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"
import { runOutcome } from "./outcome"

// #region card
const GreetInput = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(200)),
})

/** What `greet` can fail with; the card lists the same, as itself. */
export const GreetErrors = [InvalidName] as const

/** Runs `greet` on the server. */
export const greet = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(GreetInput))
  .handler(({ data }) => runOutcome(greetProgram(data.name), ...GreetErrors))
// #endregion
