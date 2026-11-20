import {
  InvalidAddress,
  Mailer,
  MailerError,
  sendTestEmail as sendTestEmailProgram,
} from "@repo/core/mailer"
import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"
import { runOutcome } from "./outcome"

/** Which transport the Mailer layer picked, and the sender it uses. */
export const mailSettings = createServerFn({ method: "GET" }).handler(() =>
  runOutcome(Mailer.useSync(({ transport, from }) => ({ transport, from }))),
)

// #region card
const SendInput = Schema.Struct({
  to: Schema.String.check(Schema.isMaxLength(320)),
})

/** What `sendTestEmail` can fail with; each reaches the browser as itself. */
export const SendTestEmailErrors = [InvalidAddress, MailerError] as const

export const sendTestEmail = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(SendInput))
  .handler(({ data }) => {
    const program = sendTestEmailProgram(data.to)
    return runOutcome(program, ...SendTestEmailErrors)
  })
// #endregion
