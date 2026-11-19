import { Schedule, Stream } from "effect"
import { greet } from "./greeting"
import { Notes } from "./notes"
import { AppRpcs } from "./rpc"

// #region card
/** What each call runs: the programs and services a server function uses. */
export const AppRpcsHandlers = AppRpcs.toLayer({
  Greet: ({ name }) => greet(name),
  Countdown: ({ from }) =>
    Stream.iterate(from, (n) => n - 1).pipe(
      Stream.take(from + 1),
      Stream.schedule(Schedule.spaced("400 millis")),
    ),
  ListNotes: () => Notes.use((notes) => notes.list),
})
// #endregion
