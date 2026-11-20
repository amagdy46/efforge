import { type ErrorComponentProps, Link } from "@tanstack/react-router"
import { CircleAlert, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"

/** What `NotConfigured` (server/settings.ts) looks like once it reaches the browser. */
interface Missing {
  readonly _tag: "NotConfigured"
  readonly setting: string
  /** Where `pnpm dev` reads it; absent outside development */
  readonly file?: string
  /** What is wrong with it: "X is not set.", or the layer's own reason */
  readonly problem?: string
}

const isMissing = (error: unknown): error is Missing =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === "NotConfigured"

/**
 * Any route's error: a missing setting names the setting and the file to put it in (a normal
 * state for a new project, not a crash); anything else shows its message and a way back.
 */
export function ErrorPage({ error, reset }: ErrorComponentProps) {
  if (isMissing(error) && error.file === undefined)
    return (
      <main className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-4 px-6 py-16">
        <Settings2 aria-hidden className="size-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">Not configured yet</h1>
        <p>
          This page needs <code className="font-mono text-[0.9em]">{error.setting}</code>, a secret
          or a variable of the Worker.
        </p>
      </main>
    )
  if (isMissing(error))
    return (
      <main className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-4 px-6 py-16">
        <Settings2 aria-hidden className="size-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">Not configured yet</h1>
        <p>
          This page needs <code className="font-mono text-[0.9em]">{error.setting}</code>.{" "}
          {error.problem ?? `${error.setting} is not set.`} Set it in{" "}
          <code className="font-mono text-[0.9em]">{error.file}</code> and restart{" "}
          <code className="font-mono text-[0.9em]">pnpm dev</code>.
        </p>
        <pre className="overflow-x-auto rounded-md border bg-code p-3 font-mono text-sm text-code-foreground">
          {`# ${error.file}\n${error.setting}=...`}
        </pre>
        <p className="text-sm text-muted-foreground">
          <code className="font-mono">.env.example</code> lists every setting with what it is for. A
          deployed Worker reads it as a secret or a variable instead.
        </p>
      </main>
    )
  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-4 px-6 py-16">
      <CircleAlert aria-hidden className="size-6 text-destructive" />
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-muted-foreground">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" asChild>
          <Link to="/">Home</Link>
        </Button>
      </div>
    </main>
  )
}
