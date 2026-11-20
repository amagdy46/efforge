import { expect, layer } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { InvalidAddress, sendTestEmail } from "../src/mailer"
import { MailerInMemory, SentMail } from "./mailer-in-memory"

layer(MailerInMemory)("sendTestEmail", (it) => {
  it.effect("sends a test email to the trimmed address and returns it as sent", () =>
    Effect.gen(function* () {
      const mail = yield* sendTestEmail("  ada@example.com ")
      expect(mail).toMatchObject({ to: "ada@example.com", from: "test@example.com" })
      expect(yield* Ref.get(yield* SentMail)).toContainEqual(
        expect.objectContaining({ to: "ada@example.com", subject: mail.subject }),
      )
    }),
  )

  it.effect("refuses something that is not an address with InvalidAddress and sends nothing", () =>
    Effect.gen(function* () {
      const sent = yield* SentMail
      const before = yield* Ref.get(sent)
      for (const to of ["", "ada", "ada@example", "a da@example.com"]) {
        const error = yield* Effect.flip(sendTestEmail(to))
        expect(error, to).toBeInstanceOf(InvalidAddress)
      }
      expect(yield* Ref.get(sent)).toEqual(before)
    }),
  )
})
