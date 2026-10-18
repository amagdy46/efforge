import { Console } from "effect"
import { Command } from "effect/cli"

/** Placeholder; Task 12 implements it. */
export const addCommand = Command.make("add", {}, () => Console.log("not implemented yet")).pipe(
  Command.withDescription("Add an add-on to an existing project"),
)
