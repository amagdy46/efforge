import { Schedule, Stream } from "effect"
import { greet } from "./greeting"
import { AppRpcs } from "./rpc"

// #region card
/** What each call runs: the same programs a server function runs. */
export const AppRpcsHandlers = AppRpcs.toLayer({
  Greet: ({ name }) => greet(name),
  Countdown: ({ from }) =>
    Stream.iterate(from, (n) => n - 1).pipe(
      Stream.take(from + 1),
      Stream.schedule(Schedule.spaced("400 millis")),
    ),
})
// #endregion
