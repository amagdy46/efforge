import { Mailer, MailerConfigError, MailerError } from "@repo/core/mailer"
import { Config, Effect, Layer } from "effect"
import { Email, WorkerConfig } from "effect-cf"
import { WorkerEnvLive } from "./cloudflare"

/** The `EMAIL` `send_email` binding (see wrangler.jsonc or infra/alchemy.run.ts). */
class EmailBinding extends Email.Tag<EmailBinding>()("EmailBinding") {}

/** Prints each message instead of sending it, so invitations and receipts are visible in `pnpm dev`. */
const ConsoleMailer = (sender: string) => {
  const from = sender === "" ? "noreply@localhost" : sender
  return Layer.succeed(
    Mailer,
    Mailer.of({
      transport: "console",
      from,
      send: (message) =>
        Effect.log(
          `[mail] from ${from} to ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
        ).pipe(Effect.withSpan("Mailer.send")),
    }),
  )
}

/** Sends through Cloudflare Email Service. `from` must be an address on a domain onboarded to Email Sending. */
const CloudflareMailer = (from: string) =>
  Layer.effect(
    Mailer,
    Effect.gen(function* () {
      const email = yield* EmailBinding
      return Mailer.of({
        transport: "cloudflare",
        from,
        send: ({ to, subject, text, html }) =>
          email.send({ from, to, subject, text, ...(html === undefined ? {} : { html }) }).pipe(
            Effect.asVoid,
            Effect.mapError(
              (cause) =>
                new MailerError({
                  operation: "send",
                  message: "Cloudflare Email Service did not send the message.",
                  cause,
                }),
            ),
            Effect.withSpan("Mailer.send"),
          ),
      })
    }),
  ).pipe(Layer.provide(EmailBinding.layer({ binding: "EMAIL" })))

/** The Cloudflare transport cannot send without a sender. */
const missingFrom = () =>
  new MailerConfigError({
    setting: "MAIL_FROM",
    message:
      "MAIL_FROM is not set. Set it to an address on a domain enabled for Cloudflare Email Sending (wrangler email sending enable <domain>), or set MAIL_TRANSPORT=console to print emails instead.",
  })

// #region card
/**
 * `Mailer`, chosen by MAIL_TRANSPORT: `console` prints each message to the
 * server log; `cloudflare` (the default) sends it from MAIL_FROM.
 */
export const MailerLive = Layer.unwrap(
  Effect.gen(function* () {
    const provider = yield* WorkerConfig.provider
    const transport = yield* Config.String("MAIL_TRANSPORT")
      .pipe(Config.withDefault("cloudflare"))
      .parse(provider)
    const sender = Config.String("MAIL_FROM").pipe(Config.withDefault(""))
    const from = yield* sender.parse(provider)
    if (transport === "console") return ConsoleMailer(from)
    if (from === "") return yield* missingFrom()
    return CloudflareMailer(from)
  }),
).pipe(Layer.provide(WorkerEnvLive))
// #endregion
