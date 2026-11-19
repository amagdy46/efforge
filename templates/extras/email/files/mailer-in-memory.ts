import { Context, Effect, Layer, Ref } from "effect"
import { type MailMessage, Mailer } from "../src/mailer"

/** What `MailerInMemory` sent, oldest first, so a test can check it. */
export class SentMail extends Context.Service<SentMail, Ref.Ref<ReadonlyArray<MailMessage>>>()(
  "test/SentMail",
) {}

/**
 * `Mailer` without a transport, for tests: messages from `test@example.com` land in `SentMail`
 * instead of an inbox. Each `layer(MailerInMemory)` block starts with none.
 */
export const MailerInMemory = Layer.effect(
  Mailer,
  Effect.gen(function* () {
    const sent = yield* SentMail
    return Mailer.of({
      transport: "console",
      from: "test@example.com",
      send: (message) => Ref.update(sent, (all) => [...all, message]),
    })
  }),
).pipe(Layer.provideMerge(Layer.effect(SentMail, Ref.make<ReadonlyArray<MailMessage>>([]))))
