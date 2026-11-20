import { Cause, Exit, Schema } from "effect"

/**
 * A setting a layer reads is missing or unusable, so nothing that needs the
 * layer can run. Routes show it as a page and cards as their "not configured"
 * state, both naming the setting and the file to put it in (server/settings.ts
 * makes it). `problem` says what is wrong: not set, or the layer's own reason.
 */
export class NotConfigured extends Schema.TaggedError<
  NotConfigured,
  { readonly brand: unique symbol }
>()("NotConfigured", {
  setting: Schema.String,
  /** Where `pnpm dev` reads it; absent outside development */
  file: Schema.optionalKey(Schema.String),
  problem: Schema.String,
  message: Schema.String,
}) {}

/** What a failed call shows: the error's tag and its message. Every tagged error is one. */
export interface Failure {
  readonly _tag: string
  readonly message: string
}

/** The schema of a tagged error a server function can fail with: a `Schema.TaggedError` class. */
export type ErrorSchema = Schema.Codec<Failure, unknown>

/**
 * A tagged error the server function did not list (a `Data.TaggedError`, say):
 * it arrives with its tag and message only. List its schema to keep its class.
 */
const AnyTagged = Schema.Struct({ _tag: Schema.String, message: Schema.String })

/** The errors a server function's `Exit` can carry: its own, `NotConfigured`, any other tag. */
export const failureCodec = <const S extends ReadonlyArray<ErrorSchema>>(errors: S) =>
  Schema.toCodecJson(
    Schema.Cause(Schema.Union([...errors, NotConfigured, AnyTagged]), Schema.Defect()),
  )

/** A failure's cause as it crosses the wire: JSON. */
export type WireCause = Schema.Codec.Encoded<ReturnType<typeof failureCodec<[]>>>

/** The `_tag` of each error schema in `S`, in order. */
export type TagsOf<S extends ReadonlyArray<ErrorSchema>> = {
  readonly [K in keyof S]: Schema.Schema.Type<S[K]>["_tag"]
}

/**
 * Error schemas whose tags are `T`, in the same order: what the browser must
 * list for a server function that lists `T` (`useServerCall`, `settleCall`).
 */
export type ErrorsFor<T extends ReadonlyArray<string>> = {
  readonly [K in keyof T]: Schema.Codec<{ readonly _tag: T[K]; readonly message: string }, unknown>
}

declare const listed: unique symbol

/**
 * What a server function returns: the `Exit` of its Effect, encoded for the
 * wire (`Schema.Exit`'s encoding). The value as it is; a failure as its
 * tagged errors with their fields, which `decodeOutcome` turns back into
 * instances of their classes. `T` is the tags of the errors the server
 * function lists, for the type checker only: the browser has to list the
 * same ones, so the two lists cannot drift apart.
 */
export type Outcome<A, C, T extends ReadonlyArray<string> = ReadonlyArray<string>> = (
  | { readonly _tag: "Success"; readonly value: A }
  | { readonly _tag: "Failure"; readonly cause: C }
) & { readonly [listed]?: T }

/** The schemas `errors` decode to, plus what every call can fail with. */
export type Errors<S extends ReadonlyArray<ErrorSchema>> =
  | Schema.Schema.Type<S[number]>
  | NotConfigured
  | Failure

/**
 * What a server function returned before efforge 0.3: the value, or the error's
 * tag and message. `upgrade` keeps a server function it cannot prove is its own,
 * so one may still answer this way; the client reads both.
 */
export type EarlierOutcome<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: Failure }

/** `outcome`, decoded with `errors` back into an `Exit` whose failures are class instances. */
export const decodeOutcome = <A, const S extends ReadonlyArray<ErrorSchema>>(
  outcome: Outcome<A, unknown> | EarlierOutcome<A>,
  errors: S,
): Exit.Exit<A, Errors<S>> => {
  if ("ok" in outcome) return outcome.ok ? Exit.succeed(outcome.value) : Exit.fail(outcome.error)
  return outcome._tag === "Success"
    ? Exit.succeed(outcome.value)
    : Exit.failCause(
        Cause.fromReasons(Schema.decodeUnknownSync(failureCodec(errors))(outcome.cause).reasons),
      )
}
