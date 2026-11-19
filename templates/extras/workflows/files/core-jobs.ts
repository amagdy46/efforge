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

/** A run id that does not belong to the caller: someone else's run and a made-up id alike. */
export class UnknownRun extends Data.TaggedError("UnknownRun")<{
  readonly message: string
}> {}

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

export interface StartOptions {
  /** The run's id; one is made when it is left out. Letters, digits, `-` and `_`, up to 100 */
  readonly id?: string
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
      options?: StartOptions,
    ) => Effect.Effect<JobRun, JobError>
    readonly status: (job: JobName, id: string) => Effect.Effect<JobStatus, JobError>
    /** Events after event `after` (-1 for all), waiting a few seconds for the next one when none is new */
    readonly events: (job: JobName, id: string, after: number) => Effect.Effect<JobEvents, JobError>
  }
>()("@repo/core/Jobs") {}

/**
 * The start of every run id `owner` starts: a hash of the owner (run ids are visible and short),
 * then `_`. `watchExample` reads only the runs whose id starts with it.
 */
export const runPrefix = (owner: string): Effect.Effect<string> =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(owner))).pipe(
    Effect.map((digest) => {
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
      return `${hex.join("").slice(0, 32)}_`
    }),
  )

// #region card
/** Starts the example workflow for `owner`; returns at once with the run id. */
export const startExample = (owner: string, input: JobPayloads["example"]) =>
  Effect.gen(function* () {
    const name = input.name.trim()
    if (name === "") {
      return yield* new MissingName({ message: "Give the workflow a name." })
    }
    const jobs = yield* Jobs
    const id = `${yield* runPrefix(owner)}${crypto.randomUUID()}`
    return yield* jobs.start("example", { ...input, name }, { id })
  })

/** What happened in `owner`'s run `id` since event `after`, and its status. */
export const watchExample = (owner: string, id: string, after: number) =>
  Effect.gen(function* () {
    if (!id.startsWith(yield* runPrefix(owner)))
      return yield* new UnknownRun({ message: "No run of yours has this id." })
    const jobs = yield* Jobs
    const { events, done } = yield* jobs.events("example", id, after)
    const { status, output, error } = yield* jobs.status("example", id)
    return { events, done, status, output, error }
  })
// #endregion
