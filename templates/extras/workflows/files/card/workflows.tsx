import { JobError, type JobEvent, MissingName, UnknownRun } from "@repo/core/jobs"
import { CircleCheck, CircleDashed, CircleX, LoaderCircle, RotateCw } from "lucide-react"
import { type SubmitEvent, useCallback, useEffect, useRef, useState } from "react"
import { FailureNote, Pending } from "@/components/demo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Failure } from "@/lib/outcome"
import { settleCall, useServerCall } from "@/lib/use-server-call"
import { startWorkflow, watchWorkflow } from "@/server/workflows-demo"
import workflow from "../workflows/Example.ts?region=card"
import program from "../../../../packages/core/src/jobs.ts?region=card"
import serverFn from "../server/workflows-demo.ts?region=card"
import type { Capability } from "./types"

/** The example workflow's steps, in the order it runs them (apps/web/src/workflows/Example.ts). */
const STEPS = [
  { name: "greet", what: "Builds the greeting; retried on failure" },
  { name: "pause", what: "Sleeps 5 seconds without holding a Worker" },
  { name: "finish", what: "Writes the result" },
] as const

type StepState = "not started" | "running" | "sleeping" | "retrying" | "done" | "failed"

/** Where a step is, from the run's events so far. */
const stepState = (events: ReadonlyArray<JobEvent>, step: string) => {
  let state: StepState = "not started"
  let note: string | undefined
  for (const event of events) {
    // Cloudflare names each step with a count: the first `greet` is `greet-1`
    if (event.step !== step && event.step?.replace(/-\d+$/, "") !== step) continue
    if (event.type === "step_started" || event.type === "attempt_started") state = "running"
    if (event.type === "sleep_started") state = "sleeping"
    if (event.type === "attempt_errored") {
      state = "retrying"
      note = `Attempt ${event.attempt ?? 1} failed: ${event.error ?? "no message"}`
    }
    if (event.type === "step_completed" || event.type === "sleep_completed") state = "done"
    if (event.type === "step_errored") state = "failed"
  }
  return { state, note }
}

const stepIcon: Record<StepState, typeof CircleCheck> = {
  "not started": CircleDashed,
  running: LoaderCircle,
  sleeping: LoaderCircle,
  retrying: RotateCw,
  done: CircleCheck,
  failed: CircleX,
}

interface Run {
  readonly id: string
  readonly events: ReadonlyArray<JobEvent>
  readonly status: string
  readonly done: boolean
  readonly message: string | undefined
  readonly error: string | undefined
}

const messageOf = (outputJson: string): string | undefined => {
  const output: unknown = JSON.parse(outputJson)
  return typeof output === "object" && output !== null && "message" in output
    ? String(output.message)
    : undefined
}

/** Follows a run until it finishes: each call waits on the server for the next events. */
function useRun() {
  const [run, setRun] = useState<Run | undefined>(undefined)
  const [failure, setFailure] = useState<
    { readonly error: Failure; readonly rejected: boolean } | undefined
  >(undefined)
  // bumped to stop following: a new run, a reset, or the card unmounting
  const current = useRef(0)
  useEffect(
    () => () => {
      current.current += 1
    },
    [],
  )

  const reset = useCallback(() => {
    current.current += 1
    setRun(undefined)
    setFailure(undefined)
  }, [])

  const follow = useCallback((id: string) => {
    current.current += 1
    const generation = current.current
    setRun({ id, events: [], status: "queued", done: false, message: undefined, error: undefined })
    setFailure(undefined)
    const next = async (after: number, seen: ReadonlyArray<JobEvent>): Promise<void> => {
      const outcome = await settleCall(watchWorkflow({ data: { id, after } }), UnknownRun, JobError)
      if (generation !== current.current) return
      if (!outcome.ok) {
        setFailure(outcome)
        return
      }
      const value = outcome.value
      const events = [...seen, ...value.events]
      setRun({
        id,
        events,
        status: value.status,
        done: value.done,
        message: messageOf(value.outputJson),
        error: value.error,
      })
      if (!value.done) await next(value.events.at(-1)?.id ?? after, events)
    }
    void next(-1, [])
  }, [])

  return { run, failure, follow, reset }
}

function WorkflowsDemo() {
  const [name, setName] = useState("Ada")
  const [failFirst, setFailFirst] = useState(true)
  const start = useServerCall(startWorkflow, MissingName, JobError)
  const { run, failure, follow, reset } = useRun()
  const running =
    start.state.status === "running" || (run !== undefined && !run.done && failure === undefined)

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    reset()
    void start.run({ data: { name, failFirstAttempt: failFirst } }).then((outcome) => {
      if (outcome.ok) follow(outcome.value.id)
    })
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-2">
        <Label htmlFor="workflows-name">Name</Label>
        <div className="flex gap-2">
          <Input
            id="workflows-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
          <Button type="submit" disabled={running}>
            Start workflow
          </Button>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={failFirst}
            onChange={(e) => setFailFirst(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <span>
            Fail the first attempt of <code className="font-mono">greet</code>, to watch it retry
          </span>
        </label>
        <p className="text-xs text-muted-foreground">
          Clear the name to see <code className="font-mono">MissingName</code> come back before
          anything starts.
        </p>
      </form>
      <div aria-live="polite" className="space-y-3">
        {start.state.status === "running" ? <Pending>Starting the workflow…</Pending> : null}
        {start.state.status === "failed" ? <FailureNote {...start.state} /> : null}
        {start.state.status === "idle" ? (
          <p className="text-sm text-muted-foreground">
            No run yet. Start one: the server function returns at once, and the run carries on in
            Cloudflare Workflows while this card follows its events.
          </p>
        ) : null}
        {run === undefined ? null : (
          <div className="space-y-3 rounded-md border bg-background p-3">
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span>
                Run <code className="font-mono text-xs break-all">{run.id}</code>
              </span>
              <span className="text-muted-foreground">
                Status: <span className="font-medium text-foreground">{run.status}</span>
              </span>
            </p>
            <ol aria-label="Workflow steps" className="space-y-2">
              {STEPS.map((step) => {
                const { state, note } = stepState(run.events, step.name)
                const Icon = stepIcon[state]
                const spinning = state === "running" || state === "sleeping"
                return (
                  <li key={step.name} className="flex gap-2 text-sm">
                    <Icon
                      aria-hidden
                      className={
                        state === "failed"
                          ? "mt-0.5 size-4 shrink-0 text-destructive"
                          : `mt-0.5 size-4 shrink-0 text-muted-foreground ${spinning ? "animate-spin" : ""}`
                      }
                    />
                    <div className="min-w-0">
                      <p>
                        <code className="font-mono">{step.name}</code>{" "}
                        <span className="text-muted-foreground">{state}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">{note ?? step.what}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
            {run.message === undefined ? null : (
              <p className="text-lg font-semibold tracking-tight">{run.message}</p>
            )}
            {run.status === "errored" ? (
              <FailureNote
                error={{ _tag: "WorkflowErrored", message: run.error ?? "The run failed." }}
              />
            ) : null}
            {run.done && run.status === "complete" ? (
              <p className="text-sm text-muted-foreground">
                Ran on Cloudflare Workflows through the <code className="font-mono">Jobs</code>{" "}
                service. Each step's result is stored, so a retry never runs a step that already
                succeeded.
              </p>
            ) : null}
          </div>
        )}
        {failure === undefined ? null : <FailureNote {...failure} />}
      </div>
    </div>
  )
}

export const workflows: Capability = {
  id: "workflows",
  title: "Workflows",
  summary:
    "Durable background jobs on Cloudflare Workflows, behind the Jobs service: start a run, follow its steps as they retry and sleep, read its result.",
  layer: { name: "JobsLive", provides: ["Jobs"], needs: ["EXAMPLE_WORKFLOW Workflow"] },
  code: [
    { path: "apps/web/src/workflows/Example.ts", source: workflow },
    { path: "packages/core/src/jobs.ts", source: program },
    { path: "apps/web/src/server/workflows-demo.ts", source: serverFn },
  ],
  files: [
    ["Service and programs", "packages/core/src/jobs.ts"],
    ["Workflow", "apps/web/src/workflows/Example.ts"],
    ["Layer", "apps/web/src/server/jobs.ts"],
  ],
  test: {
    path: "packages/core/test/jobs.test.ts",
    name: "refuses a blank name with MissingName and starts nothing",
  },
  agents: "Workflows",
  access: {
    effect: "writes",
    open: "This project has no auth, so anyone who can reach the app can start runs of the example workflow and watch any run. Add auth before you deploy it.",
    signedIn:
      "A run belongs to the user who started it: no one else can watch it. Sign-up is open to anyone until you close it (AGENTS.md, Auth).",
  },
  Demo: WorkflowsDemo,
}
