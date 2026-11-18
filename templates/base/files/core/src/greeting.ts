import { Clock, Data, Effect } from "effect"

/** The name to greet was empty or longer than 40 characters. */
export class InvalidName extends Data.TaggedError("InvalidName")<{ readonly message: string }> {}

export interface Greeting {
  readonly message: string
  /** When the server answered, in epoch milliseconds (from `Clock`, so tests can fix it). */
  readonly at: number
}

/** Greets `name`. The dashboard's runtime card calls this through a server function. */
export const greet = (name: string): Effect.Effect<Greeting, InvalidName> =>
  Effect.gen(function* () {
    const trimmed = name.trim()
    if (trimmed.length === 0 || trimmed.length > 40)
      return yield* new InvalidName({ message: "A name is 1 to 40 characters." })
    const at = yield* Clock.currentTimeMillis
    yield* Effect.log(`greeting ${trimmed}`)
    return { message: `Hello, ${trimmed}`, at }
  })
