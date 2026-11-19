import { greet as greetProgram, InvalidName } from "@repo/core/greeting"
import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"
import { runOutcome } from "./outcome"

// #region card
const GreetInput = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(200)),
})

/** Runs `greet` on the server; `InvalidName` reaches the browser as itself. */
export const greet = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(GreetInput))
  .handler(({ data }) => runOutcome(greetProgram(data.name), InvalidName))
// #endregion
