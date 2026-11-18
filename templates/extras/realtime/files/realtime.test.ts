import { expect, layer } from "@effect/vitest"
import { Context, Effect, Layer, Ref } from "effect"
import { announce, MessageTooLarge, Realtime } from "../src/realtime"
import { MAX_MESSAGE_BYTES } from "../src/realtime-limits"

/** What the fake sent, so a test can check it. */
class Sent extends Context.Service<Sent, Ref.Ref<ReadonlyArray<string>>>()("test/Sent") {}

/** `Realtime` without Durable Objects: every room has two clients, and broadcasts land in `Sent`. */
const RealtimeInMemory = Layer.effect(
  Realtime,
  Effect.gen(function* () {
    const sent = yield* Sent
    return Realtime.of({
      connect: () => Effect.succeed(new Response(null, { status: 101 })),
      broadcast: (roomId, message) => Ref.update(sent, (all) => [...all, `${roomId}: ${message}`]),
      connections: () => Effect.succeed(2),
    })
  }),
).pipe(Layer.provideMerge(Layer.effect(Sent, Ref.make<ReadonlyArray<string>>([]))))

layer(RealtimeInMemory)("announce", (it) => {
  it.effect("broadcasts to the room and returns how many are connected", () =>
    Effect.gen(function* () {
      expect(yield* announce("demo", "hello")).toBe(2)
      expect(yield* Ref.get(yield* Sent)).toContain("demo: hello")
    }),
  )

  it.effect("refuses a message over the size limit with MessageTooLarge", () =>
    Effect.gen(function* () {
      const sent = yield* Sent
      const before = yield* Ref.get(sent)
      const error = yield* Effect.flip(announce("demo", "a".repeat(MAX_MESSAGE_BYTES + 1)))
      expect(error).toBeInstanceOf(MessageTooLarge)
      expect(yield* Ref.get(sent)).toEqual(before)
    }),
  )
})
