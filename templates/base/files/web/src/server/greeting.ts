import { greet as greetProgram } from "@repo/core/greeting"
import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"
import { runOutcome } from "./outcome"

// #region card
const GreetInput = Schema.Struct({ name: Schema.String.check(Schema.isMaxLength(200)) })

/** Runs `greet` from @repo/core on the server; its `InvalidName` error comes back as data. */
export const greet = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(GreetInput))
  .handler(({ data }) => runOutcome(greetProgram(data.name)))
// #endregion
