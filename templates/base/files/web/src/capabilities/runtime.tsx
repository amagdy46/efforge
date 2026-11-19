import { type SubmitEvent, useState } from "react"
import { FailureNote, Pending } from "@/components/demo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useServerCall } from "@/lib/use-server-call"
import { greet } from "@/server/greeting"
import { InvalidName } from "@repo/core/greeting"
import program from "../../../../packages/core/src/greeting.ts?region=card"
import serverFn from "../server/greeting.ts?region=card"
import layers from "../server/layers.ts?region=card"
import client from "./runtime.tsx?region=card"
import type { Capability } from "./types"

function RuntimeDemo() {
  const [name, setName] = useState("Ada")
  // #region card
  // a failure arrives as an InvalidName again, with its fields
  const { state, run } = useServerCall(greet, InvalidName)
  const failed = state.status === "failed" ? state.error : undefined
  const invalid = failed instanceof InvalidName ? failed : undefined
  // #endregion

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    void run({ data: { name } })
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-2">
        <Label htmlFor="runtime-name">Name</Label>
        <div className="flex gap-2">
          <Input
            id="runtime-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
          />
          <Button type="submit" disabled={state.status === "running"}>
            Run on the server
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Clear the name to see the <code className="font-mono">InvalidName</code> error come back.
        </p>
      </form>
      <div aria-live="polite">
        {state.status === "running" ? <Pending>Calling greet…</Pending> : null}
        {state.status === "failed" ? <FailureNote {...state} /> : null}
        {invalid === undefined ? null : (
          <p className="mt-2 text-xs text-muted-foreground">
            <code className="font-mono">failed instanceof InvalidName</code> is true here, and its{" "}
            <code className="font-mono">length</code> field says the server counted {invalid.length}{" "}
            characters.
          </p>
        )}
        {state.status === "done" ? (
          <div className="rounded-md border bg-background p-3">
            <p className="text-lg font-semibold tracking-tight">{state.value.message}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Answered at {new Date(state.value.at).toLocaleTimeString()} by the Worker, through the{" "}
              <code className="font-mono">greet</code> program on{" "}
              <code className="font-mono">AppLayer</code>.
            </p>
          </div>
        ) : null}
        {state.status === "idle" ? (
          <p className="text-sm text-muted-foreground">
            The button calls a server function. It runs an Effect program from{" "}
            <code className="font-mono">@repo/core</code> on the app's runtime and returns its
            value, or its tagged error as data.
          </p>
        ) : null}
      </div>
    </div>
  )
}

export const runtime: Capability = {
  id: "runtime",
  title: "Runtime",
  summary:
    "Server functions run Effect programs on AppLayer, the one place this app composes its layers.",
  layer: { name: "Logger.layer", provides: ["Logger"], needs: [] },
  code: [
    { path: "packages/core/src/greeting.ts", source: program },
    { path: "apps/web/src/server/greeting.ts", source: serverFn },
    { path: "apps/web/src/server/layers.ts", source: layers },
    { path: "apps/web/src/capabilities/runtime.tsx", source: client },
  ],
  files: [
    ["Program", "packages/core/src/greeting.ts"],
    ["Server function", "apps/web/src/server/greeting.ts"],
  ],
  test: {
    path: "packages/core/test/greeting.test.ts",
    name: "greets a trimmed name at the server's time",
  },
  agents: "Effect",
  access: { effect: "reads" },
  Demo: RuntimeDemo,
}
