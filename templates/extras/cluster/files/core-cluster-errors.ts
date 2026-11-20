import { Schema } from "effect"
import { ServerOnly } from "./server-only"

/*
 * The cluster's errors and the shapes the dashboard card reads. Kept apart
 * from cluster.ts so the browser bundle gets these, not Effect Cluster.
 */

/** Longest counter name. */
export const MAX_COUNTER_NAME = 40

/** A counter name that is blank or too long. */
export class InvalidCounterName extends Schema.TaggedError<
  InvalidCounterName,
  { readonly brand: unique symbol }
>()("InvalidCounterName", { message: Schema.String, limit: Schema.Number }) {}

/** A run id that is not the caller's: someone else's run and a made-up id alike. */
export class UnknownExecution extends Schema.TaggedError<
  UnknownExecution,
  { readonly brand: unique symbol }
>()("UnknownExecution", { message: Schema.String }) {}

/** Reaching an entity, a workflow or the queue failed; `cause` stays on the server. */
export class ClusterError extends Schema.TaggedError<
  ClusterError,
  { readonly brand: unique symbol }
>()("ClusterError", { operation: Schema.String, cause: ServerOnly }) {
  override get message(): string {
    const cause = this.cause instanceof Error ? `: ${this.cause.message}` : ""
    return `Cluster ${this.operation} failed${cause}`
  }
}

/** A run's state, as the card shows it. */
export type ReviewState =
  | { readonly state: "waiting" }
  | { readonly state: "done"; readonly result: string }
  | { readonly state: "failed"; readonly message: string }
