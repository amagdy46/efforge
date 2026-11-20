import { CircleAlert, LoaderCircle, Settings2, TriangleAlert } from "lucide-react"
import type { ReactNode } from "react"
import { useStack } from "@/lib/use-stack"
import type { Failure } from "@/lib/outcome"

/** An error's own fields beyond its tag and message, as `[name, value]`. */
const fieldsOf = (error: Failure) =>
  Object.entries(error).filter(
    (entry): entry is [string, string | number | boolean] =>
      entry[0] !== "_tag" &&
      entry[0] !== "message" &&
      ["string", "number", "boolean"].includes(typeof entry[1]),
  )

/**
 * A failed call, shown as a normal state: the tagged error it received (its
 * `_tag`, message and fields) and what to do about it. `rejected` is a call the
 * server refused before its Effect answered (useServerCall says which).
 */
export function FailureNote({ error, rejected = false }: { error: Failure; rejected?: boolean }) {
  if (error._tag === "NotConfigured")
    return (
      <div role="status" className="flex gap-2 rounded-md border border-dashed p-3 text-sm">
        <Settings2 aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p>
          <span className="font-medium">Not configured yet.</span> {error.message}
        </p>
      </div>
    )
  const fields = fieldsOf(error)
  return (
    <div role="alert" className="flex gap-2 rounded-md border border-destructive/40 p-3 text-sm">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 space-y-1.5">
        <p>
          <code className="mr-1.5 rounded bg-muted px-1 py-0.5 font-mono text-[0.8em] font-medium text-destructive">
            {error._tag}
          </code>
          {error.message}
        </p>
        {fields.length === 0 ? null : (
          <dl className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
            {fields.map(([name, value]) => (
              <div key={name} className="flex min-w-0 gap-1">
                <dt>{name}:</dt>
                <dd className="break-all text-foreground">{JSON.stringify(value)}</dd>
              </div>
            ))}
          </dl>
        )}
        {rejected ? (
          <p className="text-xs text-muted-foreground">The server rejected the call.</p>
        ) : null}
      </div>
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
