import { CircleAlert, LoaderCircle, Settings2, TriangleAlert } from "lucide-react"
import type { ReactNode } from "react"
import { useStack } from "@/lib/use-stack"
import type { Failure } from "@/server/outcome"

/** A failed call, shown as a normal state: what failed (`_tag`) and what to do about it. */
export function FailureNote({ error }: { error: Failure }) {
  if (error._tag === "NotConfigured")
    return (
      <div role="status" className="flex gap-2 rounded-md border border-dashed p-3 text-sm">
        <Settings2 aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p>
          <span className="font-medium">Not configured yet.</span> {error.message}
        </p>
      </div>
    )
  return (
    <div role="alert" className="flex gap-2 rounded-md border border-destructive/40 p-3 text-sm">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <p>
        <code className="mr-1.5 rounded bg-muted px-1 py-0.5 font-mono text-[0.8em] font-medium text-destructive">
          {error._tag}
        </code>
        {error.message}
      </p>
    </div>
  )
}

/** A line of muted text with a spinner, for "loading" states. */
export function Pending({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle aria-hidden className="size-4 animate-spin" />
      {children}
    </p>
  )
}

/**
 * Shown only while the project has no auth: who can call this demo's server functions. With auth
 * every one of them requires a session, so the notice goes away by itself after `efforge add auth`.
 */
export function OpenEndpoint({ children }: { children: ReactNode }) {
  const stack = useStack()
  if (stack?.auth !== "none") return null
  return (
    <div role="note" className="flex gap-2 rounded-md border border-dashed p-3 text-sm">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <p>
        <span className="font-medium">Open endpoint.</span> {children}
      </p>
    </div>
  )
}
