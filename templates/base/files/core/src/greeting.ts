import { Clock, Data, Effect } from "effect"

// #region card
/** The name was blank or longer than 40 characters. */
export class InvalidName extends Data.TaggedError("InvalidName")<{ readonly message: string }> {}

export interface Greeting {
  readonly message: string
  /** When the server answered (epoch ms, from `Clock`) */
  readonly at: number
}

/** Greets `name`. A server function runs it; tests run it too. */
export const greet = (name: string): Effect.Effect<Greeting, InvalidName> =>
  Effect.gen(function* () {
    const trimmed = name.trim()
    if (trimmed.length === 0 || trimmed.length > 40)
      return yield* new InvalidName({ message: "A name is 1 to 40 characters." })
    const at = yield* Clock.currentTimeMillis
    yield* Effect.log(`greeting ${trimmed}`)
    return { message: `Hello, ${trimmed}`, at }
  })
// #endregion
