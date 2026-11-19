import { Context, Data, Effect } from "effect"

/** The message was not sent; `message` says what failed, `cause` is the transport's error. */
export class MailerError extends Data.TaggedError("MailerError")<{
  readonly operation: string
  readonly message: string
  readonly cause: unknown
}> {}

/** The Mailer layer could not be built: `setting` (for example MAIL_FROM) is missing. */
export class MailerConfigError extends Data.TaggedError("MailerConfigError")<{
  readonly setting: string
  readonly message: string
}> {}

/** `to` is not an email address. */
export class InvalidAddress extends Data.TaggedError("InvalidAddress")<{
  readonly message: string
}> {}

export interface MailMessage {
  readonly to: string
  readonly subject: string
  readonly text: string
  /** Optional HTML version; always send `text` too. */
  readonly html?: string
}

/** Where mail goes: printed to the server log, or sent through Cloudflare Email Service. */
export type MailTransport = "console" | "cloudflare"

/**
 * Transactional email. In production the layer sends through Cloudflare Email Service (the
 * `EMAIL` `send_email` binding); locally it prints the message to the console instead.
 */
export class Mailer extends Context.Service<
  Mailer,
  {
    readonly transport: MailTransport
    /** The sender of every message */
    readonly from: string
    readonly send: (message: MailMessage) => Effect.Effect<void, MailerError>
  }
>()("@repo/core/Mailer") {}

/** A message as it was sent, and how. */
export interface SentMail extends MailMessage {
  readonly from: string
  readonly transport: MailTransport
}

/** Loose on purpose: one `@`, a dot in the domain, no spaces. The provider checks the rest. */
const looksLikeAddress = (address: string) =>
  address.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)

// #region card
/** Sends a short test message to `to` through the configured transport. */
export const sendTestEmail = (
  to: string,
): Effect.Effect<SentMail, InvalidAddress | MailerError, Mailer> =>
  Effect.gen(function* () {
    const address = to.trim()
    if (!looksLikeAddress(address))
      return yield* new InvalidAddress({
        message: `"${address}" is not an email address.`,
      })
    const mailer = yield* Mailer
    const message = {
      to: address,
      subject: "Test email",
      text: `This came through the Mailer service (${mailer.transport}).`,
    }
    yield* mailer.send(message)
    return { ...message, from: mailer.from, transport: mailer.transport }
  })
// #endregion
