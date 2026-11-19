import { Cause, Exit, Option } from "effect"
import { useCallback, useState } from "react"
import { asFailure } from "./failure"
import { decodeOutcome, type ErrorSchema, type Errors, type Failure, type Outcome } from "./outcome"

/** A call's result: its value, or the error it failed with. */
export type CallResult<A, E> =
  | { readonly ok: true; readonly value: A }
  | {
      readonly ok: false
      readonly error: E | Failure
      /**
       * True when the call was refused before its Effect could answer: the
       * session gate (`Unauthorized`), the validator (`InvalidInput`), no
       * answer (`Unreachable`) or a bug, a 500 (`Defect`). False when the
       * Effect failed with one of its own tagged errors.
       */
      readonly rejected: boolean
    }

export type CallState<A, E> =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "done"; readonly value: A }
  | ({ readonly status: "failed" } & Extract<CallResult<A, E>, { readonly ok: false }>)

/** `exit` as a call result: its value, or its first tagged error. */
const resultOf = <A, E>(exit: Exit.Exit<A, E>): CallResult<A, E> => {
  if (Exit.isSuccess(exit)) return { ok: true, value: exit.value }
  const error = Cause.findErrorOption(exit.cause)
  return Option.isSome(error)
    ? { ok: false, error: error.value, rejected: false }
    : { ok: false, error: { _tag: "Defect", message: "The call failed." }, rejected: true }
}

/**
 * One call's result, outside a hook: the outcome decoded with `errors` (what
 * `useServerCall` runs), or `asFailure(error)` for a call the server rejected.
 */
export const settleCall = <A, const S extends ReadonlyArray<ErrorSchema> = []>(
  call: Promise<Outcome<A, unknown>>,
  ...errors: S
): Promise<CallResult<A, Errors<S>>> =>
  call.then(
    (outcome) => resultOf(decodeOutcome(outcome, errors)),
    (error: unknown) => ({ ok: false, error: asFailure(error), rejected: true }) as const,
  )

/**
 * Calls a server function that returns an `Outcome` (server/outcome.ts) and
 * tracks it as idle, running, done or failed. Pass the error classes the
 * server function lists: a failure is then an instance of its class, with its
 * fields, so `state.error instanceof InvalidName` works. A call the server
 * rejects fails with `asFailure(error)` and `rejected: true`.
 */
export function useServerCall<
  A,
  I extends ReadonlyArray<unknown>,
  const S extends ReadonlyArray<ErrorSchema> = [],
>(call: (...input: I) => Promise<Outcome<A, unknown>>, ...errors: S) {
  const [state, setState] = useState<CallState<A, Errors<S>>>({ status: "idle" })
  // the classes to decode into; the same on every render
  const [listed] = useState(errors)
  const run = useCallback(
    (...input: I): Promise<CallResult<A, Errors<S>>> => {
      setState({ status: "running" })
      return settleCall(call(...input), ...listed).then((result) => {
        setState(
          result.ok ? { status: "done", value: result.value } : { status: "failed", ...result },
        )
        return result
      })
    },
    [call, listed],
  )
  return { state, run }
}
