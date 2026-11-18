import { expect, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Mailer, MailerError, type MailMessage } from "../src/mailer"

// The code under test. It asks for Mailer and never sees a layer.
const sendWelcome = (to: string) =>
  Effect.gen(function* () {
    const mailer = yield* Mailer
    yield* mailer.send({ to, subject: "Welcome", text: "Thanks for signing up." })
    return "sent" as const
  }).pipe(Effect.catchTag("MailerError", () => Effect.succeed("not sent" as const)))

// Test layer: keeps each message in an array instead of sending it.
const outbox: Array<MailMessage> = []
const MailerInMemory = Layer.succeed(
  Mailer,
  Mailer.of({ send: (message) => Effect.sync(() => outbox.push(message)) }),
)

// Test layer: every send fails, the way it would if the provider were down.
const MailerDown = Layer.succeed(
  Mailer,
  Mailer.of({ send: () => Effect.fail(new MailerError({ operation: "send", cause: "down" })) }),
)

layer(MailerInMemory)("with a working mailer", (it) => {
  it.effect("sends the welcome message", () =>
    Effect.gen(function* () {
      expect(yield* sendWelcome("ada@example.com")).toBe("sent")
      expect(outbox).toEqual([
        { to: "ada@example.com", subject: "Welcome", text: "Thanks for signing up." },
      ])
    }),
  )
})

layer(MailerDown)("with a mailer that is down", (it) => {
  it.effect("reports a failed send instead of failing", () =>
    Effect.gen(function* () {
      expect(yield* sendWelcome("ada@example.com")).toBe("not sent")
    }),
  )
})
