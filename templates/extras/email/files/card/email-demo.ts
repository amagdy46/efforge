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

/** `InvalidAddress` and `MailerError` reach the browser as themselves. */
export const sendTestEmail = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(SendInput))
  .handler(({ data }) => runOutcome(sendTestEmailProgram(data.to), InvalidAddress, MailerError))
// #endregion
