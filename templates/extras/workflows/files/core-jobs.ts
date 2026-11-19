import { Context, Data, Effect } from "effect"

/** Starting a job or reading it failed; `cause` is the underlying error. */
export class JobError extends Data.TaggedError("JobError")<{
  readonly operation: string
  readonly cause: unknown
}> {
  override get message(): string {
    const cause = this.cause instanceof Error ? `: ${this.cause.message}` : ""
    return `Job ${this.operation} failed${cause}`
  }
}

/** The example job needs a name to greet. */
export class MissingName extends Data.TaggedError("MissingName")<{
  readonly message: string
}> {}

/** Payload per job name. Add an entry here when you add a workflow. */
export interface JobPayloads {
  readonly example: {
    readonly name: string
    /** Fail the first attempt of the `greet` step, to watch it retry */
    readonly failFirstAttempt: boolean
  }
}

export type JobName = keyof JobPayloads

export interface JobRun {
  readonly id: string
}

export interface JobStatus {
  readonly status:
    | "queued"
    | "rollingBack"
    | "running"
    | "paused"
    | "errored"
    | "terminated"
    | "complete"
    | "waiting"
    | "waitingForPause"
    | "unknown"
  readonly output: unknown
  readonly error: string | undefined
}

/** One thing that happened in a run: a step started, an attempt failed, a sleep ended. */
export interface JobEvent {
  /** Increases with each event; pass the last one as `after` to read on from it */
  readonly id: number
  /** Cloudflare's event type, e.g. `step_started`, `attempt_errored`, `workflow_completed` */
  readonly type: string
  readonly step: string | undefined
  readonly attempt: number | undefined
  readonly error: string | undefined
  /** Epoch ms */
  readonly at: number
}

export interface JobEvents {
  readonly events: ReadonlyArray<JobEvent>
  /** The run has finished (completed, errored or terminated): no more events will come */
  readonly done: boolean
}

/** Durable background jobs. The Cloudflare layer starts Cloudflare Workflows. */
export class Jobs extends Context.Service<
  Jobs,
  {
    readonly start: <N extends JobName>(
      job: N,
      payload: JobPayloads[N],
    ) => Effect.Effect<JobRun, JobError>
    readonly status: (job: JobName, id: string) => Effect.Effect<JobStatus, JobError>
    /** Events after event `after` (-1 for all), waiting a few seconds for the next one when none is new */
    readonly events: (job: JobName, id: string, after: number) => Effect.Effect<JobEvents, JobError>
  }
>()("@repo/core/Jobs") {}

// #region card
/** Starts the example workflow; it returns at once with the run's id. */
export const startExample = (name: string, failFirstAttempt: boolean) =>
  Effect.gen(function* () {
    const trimmed = name.trim()
    if (trimmed === "") return yield* new MissingName({ message: "Give the workflow a name." })
    const jobs = yield* Jobs
    return yield* jobs.start("example", { name: trimmed, failFirstAttempt })
  })

/** What happened in run `id` since event `after`, and where it is now. */
export const watchExample = (id: string, after: number) =>
  Effect.gen(function* () {
    const jobs = yield* Jobs
    const { events, done } = yield* jobs.events("example", id, after)
    const { status, output, error } = yield* jobs.status("example", id)
    return { events, done, status, output, error }
  })
// #endregion
