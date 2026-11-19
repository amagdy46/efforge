import {
  ClusterError,
  InvalidCounterName,
  MAX_COUNTER_NAME,
  type ReviewState,
  UnknownExecution,
} from "@repo/core/cluster-errors"
import { CircleCheck, CircleDashed, Hourglass } from "lucide-react"
import { type SubmitEvent, useState } from "react"
import { FailureNote, Pending } from "@/components/demo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Failure } from "@/lib/outcome"
import { type CallResult, useServerCall } from "@/lib/use-server-call"
import {
  approveReviewRun,
  incrementCounter,
  sendGreeting,
  startReviewRun,
  watchReviewRun,
} from "@/server/cluster-demo"
import program from "../../../../packages/core/src/cluster.ts?region=card"
import handlers from "../../../../packages/core/src/cluster-handlers.ts?region=card"
import layer from "../server/cluster.ts?region=card"
import serverFn from "../server/cluster-demo.ts?region=card"
import type { Capability } from "./types"

/** An entity: one Durable Object per counter name, holding its count in SQLite. */
function CounterRow() {
  const [name, setName] = useState("visits")
  const call = useServerCall(incrementCounter, InvalidCounterName, ClusterError)
  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    void call.run({ data: { name } })
  }
  return (
    <section aria-labelledby="cluster-entity" className="space-y-2">
      <h4 id="cluster-entity" className="text-sm font-medium">
        Entity <code className="font-mono font-normal">Counter</code>
      </h4>
      <form onSubmit={submit} className="space-y-2">
        <Label htmlFor="cluster-counter-name">Counter name</Label>
        <div className="flex gap-2">
          <Input
            id="cluster-counter-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_COUNTER_NAME}
          />
          <Button type="submit" disabled={call.state.status === "running"}>
            Increment
          </Button>
        </div>
      </form>
      <div aria-live="polite" className="text-sm">
        {call.state.status === "idle" ? (
          <p className="text-muted-foreground">
            Each name is its own counter, in its own Durable Object. Clear the name to see{" "}
            <code className="font-mono">InvalidCounterName</code>.
          </p>
        ) : null}
        {call.state.status === "running" ? <Pending>Asking the entity…</Pending> : null}
        {call.state.status === "done" ? (
          <p>
            <span className="text-lg font-semibold tabular-nums">{call.state.value}</span>{" "}
            <span className="text-muted-foreground">
              in the entity's own SQLite. Reload the page or open a second tab: it carries on.
            </span>
          </p>
        ) : null}
        {call.state.status === "failed" ? <FailureNote {...call.state} /> : null}
      </div>
    </section>
  )
}

type Step = "not started" | "waiting" | "done"

const approvalStep = (state: ReviewState | undefined): Step => {
  if (state === undefined) return "not started"
  return state.state === "waiting" ? "waiting" : "done"
}

const stepIcon = { "not started": CircleDashed, waiting: Hourglass, done: CircleCheck }

/** A workflow: two activities around a durable wait for an approval. */
function ReviewRow() {
  const [title, setTitle] = useState("Release notes")
  const [run, setRun] = useState<string | undefined>(undefined)
  const [state, setState] = useState<ReviewState | undefined>(undefined)
  const [failure, setFailure] = useState<
    { readonly error: Failure; readonly rejected: boolean } | undefined
  >(undefined)
  const start = useServerCall(startReviewRun, ClusterError)
  const watch = useServerCall(watchReviewRun, UnknownExecution, ClusterError)
  const approve = useServerCall(approveReviewRun, UnknownExecution, ClusterError)
  const busy = [start, watch, approve].some((c) => c.state.status === "running")

  const settle = (outcome: CallResult<ReviewState, Failure>) => {
    if (outcome.ok) setState(outcome.value)
    else setFailure(outcome)
  }

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    setState(undefined)
    setFailure(undefined)
    void start.run({ data: { title } }).then((outcome) => {
      if (!outcome.ok) return setFailure(outcome)
      setRun(outcome.value.run)
      return watch.run({ data: { run: outcome.value.run } }).then(settle)
    })
  }

  const onApprove = () => {
    if (run === undefined) return
    setFailure(undefined)
    void approve.run({ data: { run } }).then(settle)
  }

  const steps: ReadonlyArray<readonly [string, Step, string]> = [
    ["draft", state === undefined ? "not started" : "done", "Activity: writes the draft"],
    [
      "approval",
      approvalStep(state),
      "Durable wait: the run is suspended, no Worker held, until you approve",
    ],
    ["publish", state?.state === "done" ? "done" : "not started", "Activity: publishes"],
  ]

  return (
    <section aria-labelledby="cluster-workflow" className="space-y-2">
      <h4 id="cluster-workflow" className="text-sm font-medium">
        Workflow <code className="font-mono font-normal">Review</code>
      </h4>
      <form onSubmit={submit} className="space-y-2">
        <Label htmlFor="cluster-review-title">Title</Label>
        <div className="flex gap-2">
          <Input
            id="cluster-review-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
          />
          <Button type="submit" disabled={busy}>
            Start
          </Button>
        </div>
      </form>
      <div aria-live="polite" className="space-y-2 text-sm">
        {start.state.status === "running" ? <Pending>Starting the run…</Pending> : null}
        {run === undefined ? null : (
          <ol
            aria-label="Workflow steps"
            className="space-y-1.5 rounded-md border bg-background p-3"
          >
            {steps.map(([step, at, what]) => {
              const Icon = stepIcon[at]
              return (
                <li key={step} className="flex gap-2">
                  <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p>
                      <code className="font-mono">{step}</code>{" "}
                      <span className="text-muted-foreground">{at}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{what}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        {state?.state === "waiting" ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={onApprove}>
            Approve
          </Button>
        ) : null}
        {state?.state === "done" ? <p className="font-medium">{state.result}</p> : null}
        {state?.state === "failed" ? (
          <FailureNote error={{ _tag: "WorkflowFailed", message: state.message }} />
        ) : null}
        {failure === undefined ? null : <FailureNote {...failure} />}
      </div>
    </section>
  )
}

/** What the worker wrote, or that the item is still waiting for one. */
function Greeting({ greeting, ms }: { greeting: string | undefined; ms: number }) {
  if (greeting === undefined)
    return (
      <p className="text-muted-foreground">
        Still queued after {ms} ms. The next offer's worker takes it first.
      </p>
    )
  return (
    <p>
      <span className="font-medium">{greeting}</span>{" "}
      <span className="text-muted-foreground">({ms} ms)</span>
    </p>
  )
}

/** A durable queue: the request that offers an item runs the worker. */
function QueueRow() {
  const [name, setName] = useState("Ada")
  const call = useServerCall(sendGreeting, ClusterError)
  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    void call.run({ data: { name } })
  }
  return (
    <section aria-labelledby="cluster-queue" className="space-y-2">
      <h4 id="cluster-queue" className="text-sm font-medium">
        Queue <code className="font-mono font-normal">GreetingQueue</code>
      </h4>
      <form onSubmit={submit} className="space-y-2">
        <Label htmlFor="cluster-greet-name">Name to greet</Label>
        <div className="flex gap-2">
          <Input
            id="cluster-greet-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
          <Button type="submit" disabled={call.state.status === "running"}>
            Offer
          </Button>
        </div>
      </form>
      <div aria-live="polite" className="text-sm">
        {call.state.status === "idle" ? (
          <p className="text-muted-foreground">
            Nothing runs a queue worker in the background on Workers. This request offers the item
            and then runs the worker itself, for up to 10 seconds.
          </p>
        ) : null}
        {call.state.status === "running" ? (
          <Pending>Offering, then running the worker…</Pending>
        ) : null}
        {call.state.status === "done" ? <Greeting {...call.state.value} /> : null}
        {call.state.status === "failed" ? <FailureNote {...call.state} /> : null}
      </div>
    </section>
  )
}

function ClusterDemo() {
  return (
    <div className="space-y-6">
      <p className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Experimental.</span>{" "}
        <code className="font-mono">@effect/platform-cloudflare</code> may change in a patch
        release, so efforge pins it exactly. A durable sleep wakes about a minute late today, so
        this workflow waits on an approval instead. AGENTS.md, Cluster, lists every limit.
      </p>
      <CounterRow />
      <ReviewRow />
      <QueueRow />
    </div>
  )
}

export const cluster: Capability = {
  id: "cluster",
  title: "Cluster (experimental)",
  summary:
    "Effect Cluster on Durable Objects: an entity that keeps its state, a workflow that waits durably, and a queue whose worker runs in the request that offers.",
  layer: {
    name: "ClusterLive",
    provides: ["Sharding", "WorkflowEngine", "Counter", "Review", "Greet"],
    needs: ["CLUSTER_ENTITY, CLUSTER_WORKFLOW, CLUSTER_QUEUE, CLUSTER_SINGLETON Durable Objects"],
  },
  code: [
    { path: "packages/core/src/cluster.ts", source: program },
    { path: "packages/core/src/cluster-handlers.ts", source: handlers },
    { path: "apps/web/src/server/cluster.ts", source: layer },
    { path: "apps/web/src/server/cluster-demo.ts", source: serverFn },
  ],
  files: [
    ["Entity, workflow, queue and programs", "packages/core/src/cluster.ts"],
    ["Handlers", "packages/core/src/cluster-handlers.ts"],
    ["Layer", "apps/web/src/server/cluster.ts"],
    ["Durable Object classes", "apps/web/src/cluster/objects.ts"],
  ],
  test: {
    path: "packages/core/test/cluster.test.ts",
    name: "refuses a blank counter name with InvalidCounterName",
  },
  agents: "Cluster (experimental)",
  access: {
    effect: "writes",
    open: "This project has no auth, so anyone who can reach the app shares the same counters and can start, watch and approve any run. Add auth before you deploy it.",
    signedIn:
      "Counters and runs belong to the user who made them: no one else can read or approve them. The greeting queue is shared: a worker in any user's request writes any waiting greeting, and each goes back to the run that offered it. Sign-up is open to anyone until you close it (AGENTS.md, Auth).",
  },
  Demo: ClusterDemo,
}
