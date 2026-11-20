import { expect, layer } from "@effect/vitest"
import { Effect, Fiber, Layer, Stream } from "effect"
import { FetchHttpClient, HttpEffect } from "effect/http"
import { RpcClient, RpcSerialization, RpcServer } from "effect/rpc"
import { TestClock } from "effect/testing"
import { InvalidName } from "../src/greeting"
import { type Note, Notes, NotesUnavailable } from "../src/notes"
import { AppRpcs, rpcOverHttp } from "../src/rpc"
import { AppRpcsHandlers } from "../src/rpc-handlers"

const note: Note = { id: "1", title: "Buy milk", createdAt: new Date(0) }

/** `Notes` with one note, or failing: the test layers that stand in for the database. */
const NotesWith = (list: Effect.Effect<ReadonlyArray<Note>, NotesUnavailable>) =>
  Layer.succeed(Notes, Notes.of({ list, insert: () => Effect.die("not used") }))

/**
 * The server's handler answering the client's `fetch` in memory: each call
 * crosses the wire as ndjson, as it does from the browser, with no network.
 */
const serverInMemory = (notes: Layer.Layer<Notes>) =>
  Layer.effect(
    FetchHttpClient.Fetch,
    Effect.map(RpcServer.toHttpEffect(AppRpcs), (http) => {
      const handle = HttpEffect.toWebHandler(http)
      return (...request: Parameters<typeof fetch>) => handle(new Request(...request))
    }),
  ).pipe(Layer.provide([AppRpcsHandlers, RpcSerialization.layerNdjson]), Layer.provide(notes))

const clientWith = (notes: Layer.Layer<Notes>) =>
  rpcOverHttp("http://app.test/api/rpc").pipe(Layer.provide(serverInMemory(notes)))

layer(clientWith(NotesWith(Effect.succeed([note]))))("AppRpcs", (it) => {
  it.effect("Greet fails with InvalidName, its fields intact", () =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(AppRpcs)
      const error = yield* Effect.flip(client.Greet({ name: "  " }))
      expect(error).toBeInstanceOf(InvalidName)
      expect(error).toMatchObject({ length: 0, message: "A name is 1 to 40 characters." })
      expect((yield* client.Greet({ name: "Ada" })).message).toBe("Hello, Ada")
    }).pipe(Effect.scoped),
  )

  it.effect("Countdown streams a number each time the clock moves", () =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(AppRpcs)
      const fiber = yield* Stream.runCollect(client.Countdown({ from: 3 })).pipe(Effect.forkScoped)
      yield* TestClock.adjust("2 seconds")
      expect(yield* Fiber.join(fiber)).toEqual([3, 2, 1, 0])
    }).pipe(Effect.scoped),
  )
})

layer(clientWith(NotesWith(Effect.succeed([note]))))("AppRpcs with notes", (it) => {
  it.effect("ListNotes reads the Notes service, dates intact", () =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(AppRpcs)
      expect(yield* client.ListNotes()).toEqual([note])
    }).pipe(Effect.scoped),
  )
})

const unavailable = new NotesUnavailable({
  reason: "not-migrated",
  message: "The note table does not exist yet. Run pnpm db:migrate, then reload.",
  cause: "no such table: note",
})

layer(clientWith(NotesWith(Effect.fail(unavailable))))("AppRpcs without a database", (it) => {
  it.effect("ListNotes fails with NotesUnavailable, its driver error left on the server", () =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(AppRpcs)
      const error = yield* Effect.flip(client.ListNotes())
      expect(error).toBeInstanceOf(NotesUnavailable)
      expect(error).toMatchObject({ reason: "not-migrated" })
      expect(error).not.toHaveProperty("cause", "no such table: note")
    }).pipe(Effect.scoped),
  )
})
