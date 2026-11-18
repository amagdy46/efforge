import { announce as announceProgram } from "@repo/core/realtime"
import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"
import { runOutcome } from "./outcome"

// #region card
const AnnounceInput = Schema.Struct({ text: Schema.String })

/** Broadcasts to the room from the server, through the `Realtime` service. */
export const announce = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(AnnounceInput))
  .handler(({ data }) => runOutcome(announceProgram("demo", data.text)))
// #endregion
