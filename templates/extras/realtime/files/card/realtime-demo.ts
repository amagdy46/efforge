import { announce as announceProgram, MessageTooLarge, RealtimeError } from "@repo/core/realtime"
import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"
import { runOutcome } from "./outcome"

// #region card
const AnnounceInput = Schema.Struct({ text: Schema.String })

/** What `announce` can fail with; the card lists the same, as classes. */
export const AnnounceErrors = [MessageTooLarge, RealtimeError] as const

/** Broadcasts to the room from the server, through the `Realtime` service. */
export const announce = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(AnnounceInput))
  .handler(({ data }) => {
    const program = announceProgram("demo", data.text)
    return runOutcome(program, ...AnnounceErrors)
  })
// #endregion
