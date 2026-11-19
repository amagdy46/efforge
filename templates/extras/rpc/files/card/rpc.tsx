import { RegistryProvider, useAtomSet, useAtomValue } from "@effect/atom-react"
import { Cause, Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { RpcClientError } from "effect/rpc"
import { type SubmitEvent, useState } from "react"
import { FailureNote, Pending } from "@/components/demo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Failure } from "@/lib/outcome"
import { countdownAtom, greetAtom } from "@/lib/rpc-client"
import { InvalidName } from "@repo/core/greeting"
import group from "../../../../packages/core/src/rpc.ts?region=card"
import handlers from "../../../../packages/core/src/rpc-handlers.ts?region=card"
import client from "../lib/rpc-client.ts?region=card"
import call from "./rpc.tsx?region=card"
import type { Capability } from "./types"

/**
 * A failed call as `FailureNote` shows a server function's: its tagged error,
 * and `rejected` when it was refused before a handler ran (no session, no
 * answer from the server).
 */
const failureOf = <A, E extends Failure>(result: AsyncResult.AsyncResult<A, E>) => {
  if (!AsyncResult.isFailure(result)) return undefined
  const error = Cause.findErrorOption(result.cause)
  if (Option.isNone(error))
    return { error: { _tag: "Defect", message: "The call failed." }, rejected: true }
  const rejected =
    error.value instanceof RpcClientError.RpcClientError || error.value._tag === "Unauthorized"
  return { error: error.value, rejected }
}

function Greet() {
  const [name, setName] = useState("Ada")
  // #region card
  const result = useAtomValue(greetAtom)
  const greet = useAtomSet(greetAtom)
  // greet({ payload: { name } }) calls it; a failure is an InvalidName again
  const failed = failureOf(result)
  const error = failed?.error
  const invalid = error instanceof InvalidName ? error : undefined
  // #endregion

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    greet({ payload: { name } })
  }

  return (
    <div className="space-y-2">
      <form onSubmit={submit} className="space-y-2">
        <Label htmlFor="rpc-name">Name</Label>
        <div className="flex gap-2">
          <Input
            id="rpc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
          />
          <Button type="submit" disabled={result.waiting}>
            Call Greet
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Clear the name to see <code className="font-mono">InvalidName</code> come back over RPC.
        </p>
      </form>
      <div aria-live="polite" className="space-y-2">
        {result.waiting ? <Pending>Calling Greet…</Pending> : null}
        {failed === undefined ? null : <FailureNote {...failed} />}
        {invalid === undefined ? null : (
          <p className="text-xs text-muted-foreground">
            <code className="font-mono">instanceof InvalidName</code> holds in the browser, and its{" "}
            <code className="font-mono">length</code> field says the server counted {invalid.length}{" "}
            characters.
          </p>
        )}
        {AsyncResult.isSuccess(result) && !result.waiting ? (
          <div className="rounded-md border bg-background p-3">
            <p className="text-lg font-semibold tracking-tight">{result.value.message}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Answered at {new Date(result.value.at).toLocaleTimeString()} by the{" "}
              <code className="font-mono">Greet</code> handler, which runs the{" "}
              <code className="font-mono">greet</code> program on{" "}
              <code className="font-mono">AppLayer</code>.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Countdown() {
  const result = useAtomValue(countdownAtom)
  const start = useAtomSet(countdownAtom)
  const failed = failureOf(result)
  const idle = result.waiting
    ? "Opening the stream…"
    : "One call; each number arrives as the server sends it."
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" disabled={result.waiting} onClick={() => start(5)}>
          Stream a countdown
        </Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {AsyncResult.isSuccess(result) ? (
            <>
              <span className="font-mono text-base font-semibold text-foreground">
                {result.value}
              </span>{" "}
              {result.waiting ? "arriving, one every 400 ms" : "the stream ended"}
            </>
          ) : (
            idle
          )}
        </p>
      </div>
      {failed === undefined ? null : <FailureNote {...failed} />}
    </div>
  )
}

/**
 * Each demo starts from a click, so nothing calls the server while the page
 * renders on the server, and the provider gives this card its own registry.
 */
function RpcDemo() {
  return (
    <RegistryProvider>
      <div className="space-y-5">
        <Greet />
        <Countdown />
      </div>
    </RegistryProvider>
  )
}

export const rpc: Capability = {
  id: "rpc",
  title: "Effect RPC",
  summary:
    "A typed client for an Effect RPC group at /api/rpc: values, tagged errors and a stream, on the layers the server functions use.",
  layer: { name: "RpcLive", provides: ["RpcHandler"], needs: [] },
  code: [
    { path: "packages/core/src/rpc.ts", source: group },
    { path: "packages/core/src/rpc-handlers.ts", source: handlers },
    { path: "apps/web/src/lib/rpc-client.ts", source: client },
    { path: "apps/web/src/capabilities/rpc.tsx", source: call },
  ],
  files: [
    ["Group", "packages/core/src/rpc.ts"],
    ["Server and route", "apps/web/src/server/rpc.ts"],
  ],
  test: {
    path: "packages/core/test/rpc.test.ts",
    name: "Greet fails with InvalidName, its fields intact",
  },
  agents: "Effect RPC",
  access: { effect: "reads" },
  Demo: RpcDemo,
}
