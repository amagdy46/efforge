import { useCallback, useState } from "react"
import type { Failure, Outcome } from "@/server/outcome"

export type CallState<A> =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "done"; readonly value: A }
  | { readonly status: "failed"; readonly error: Failure }

/**
 * Calls a server function that returns an `Outcome` (see server/outcome.ts) and tracks it as one
 * of four states. A rejected call (the server threw) becomes a failure with `_tag: "Defect"`.
 */
export function useServerCall<A, I extends ReadonlyArray<unknown>>(
  call: (...input: I) => Promise<Outcome<A>>,
) {
  const [state, setState] = useState<CallState<A>>({ status: "idle" })
  const run = useCallback(
    (...input: I) => {
      setState({ status: "running" })
      return call(...input).then(
        (outcome) =>
          setState(
            outcome.ok
              ? { status: "done", value: outcome.value }
              : { status: "failed", error: outcome.error },
          ),
        (error: unknown) =>
          setState({
            status: "failed",
            error: {
              _tag: "Defect",
              message: error instanceof Error ? error.message : String(error),
            },
          }),
      )
    },
    [call],
  )
  return { state, run }
}
