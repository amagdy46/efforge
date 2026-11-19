import { type SubmitEvent, useState } from "react"
import { FailureNote, Pending } from "@/components/demo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useServerCall } from "@/lib/use-server-call"
import { visitPage } from "@/server/browser-demo"
import type { Failure } from "@/server/outcome"
import program from "../../../../packages/core/src/browser.ts?region=card"
import serverFn from "../server/browser-demo.ts?region=card"
import type { Capability } from "./types"

/** No container in local dev is a setup step, not a bug: show it as "not configured". */
const shown = (error: Failure): Failure =>
  error._tag === "BrowserUnavailable" ? { _tag: "NotConfigured", message: error.message } : error

function BrowserDemo() {
  const [url, setUrl] = useState("https://example.com")
  const { state, run } = useServerCall(visitPage)

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    void run({ data: { url } })
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-2">
        <Label htmlFor="browser-url">Address</Label>
        <div className="flex gap-2">
          <Input
            id="browser-url"
            inputMode="url"
            autoComplete="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            maxLength={2048}
          />
          <Button type="submit" disabled={state.status === "running"}>
            Open
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Try <code className="font-mono">http://localhost</code> to see the container refuse it
          with <code className="font-mono">UrlRefused</code>, or leave out the scheme for{" "}
          <code className="font-mono">InvalidUrl</code>.
        </p>
      </form>
      <div aria-live="polite" className="space-y-3">
        {state.status === "idle" ? (
          <p className="text-sm text-muted-foreground">
            The button sends the address to Playwright in a container through the{" "}
            <code className="font-mono">Browser</code> service. It loads the page, counts its
            requests and takes a screenshot.
          </p>
        ) : null}
        {state.status === "running" ? (
          <Pending>Loading the page. The first visit starts the container, up to a minute…</Pending>
        ) : null}
        {state.status === "failed" ? <FailureNote error={shown(state.error)} /> : null}
        {state.status === "done" ? (
          <figure className="space-y-2 rounded-md border bg-background p-3">
            <img
              src={`data:image/jpeg;base64,${state.value.screenshot}`}
              alt={`The page "${state.value.title}" as the browser loaded it`}
              className="aspect-[8/5] w-full rounded border object-cover object-top"
            />
            <figcaption className="text-sm">
              <span className="font-medium break-words">
                {state.value.title || "Untitled page"}
              </span>
              <span className="block text-muted-foreground">
                {state.value.requests} {state.value.requests === 1 ? "request" : "requests"}, loaded
                by Chromium in the browser container through the{" "}
                <code className="font-mono">Browser</code> service.
              </span>
            </figcaption>
          </figure>
        ) : null}
      </div>
    </div>
  )
}

export const browser: Capability = {
  id: "browser",
  title: "Browser",
  summary:
    "Headless Chromium in a container, behind the Browser service: open a page, see what it loaded and how it looked.",
  layer: { name: "BrowserLive", provides: ["Browser"], needs: ["BROWSER container"] },
  code: [
    { path: "packages/core/src/browser.ts", source: program },
    { path: "apps/web/src/server/browser-demo.ts", source: serverFn },
  ],
  files: [
    ["Service and program", "packages/core/src/browser.ts"],
    ["Layer", "apps/web/src/server/browser.ts"],
    ["Container (Playwright)", "apps/browser/src/server.ts"],
  ],
  test: {
    path: "packages/core/test/browser.test.ts",
    name: "refuses an address that is not http(s) with InvalidUrl and never opens it",
  },
  agents: "Browser",
  Demo: BrowserDemo,
}
