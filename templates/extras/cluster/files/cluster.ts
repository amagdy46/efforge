import * as CloudflareCluster from "@effect/platform-cloudflare/CloudflareCluster"
import { Counter } from "@repo/core/cluster"
import { ClusterHandlers } from "@repo/core/cluster-handlers"
import { Effect, Layer, ManagedRuntime } from "effect"
import { WorkerEnvironment } from "effect-cf"
import { WorkerEnvLive } from "./cloudflare"

/** The four Durable Object bindings the cluster runs on (see AGENTS.md, Cluster). */
export const CLUSTER_BINDINGS = [
  "CLUSTER_ENTITY",
  "CLUSTER_WORKFLOW",
  "CLUSTER_QUEUE",
  "CLUSTER_SINGLETON",
] as const

const isNamespace = (value: unknown): value is DurableObjectNamespace =>
  typeof value === "object" && value !== null && "getByName" in value

const namespace = (env: object, name: (typeof CLUSTER_BINDINGS)[number]) => {
  const value: unknown = Reflect.get(env, name)
  return isNamespace(value)
    ? Effect.succeed(value)
    : Effect.die(
        new Error(
          `The Worker has no Durable Object binding ${name}. The cluster add-on declares it beside the Worker (wrangler.jsonc, or infra/alchemy.run.ts); run \`npx -y create-efforge doctor\`.`,
        ),
      )
}

// #region card
/** Entities, workflows and queues on Durable Objects; the handlers register here. */
const ClusterServices = ClusterHandlers.pipe(
  Layer.provideMerge(
    Layer.unwrap(
      Effect.gen(function* () {
        const env = yield* WorkerEnvironment
        return CloudflareCluster.layer({
          entities: [Counter],
          entityNamespace: yield* namespace(env, "CLUSTER_ENTITY"),
          workflowNamespace: yield* namespace(env, "CLUSTER_WORKFLOW"),
          queueNamespace: yield* namespace(env, "CLUSTER_QUEUE"),
          singletonNamespace: yield* namespace(env, "CLUSTER_SINGLETON"),
        })
      }),
    ),
  ),
  Layer.provide(WorkerEnvLive),
)

/**
 * One cluster per Worker isolate, built once: the Durable Objects wait for it
 * (`../cluster/objects.ts`), and the handlers stay registered while it lives.
 */
export const clusterRuntime = ManagedRuntime.make(ClusterServices)

/** Server functions get `Sharding` and `WorkflowEngine` from it. */
export const ClusterLive = Layer.effectContext(clusterRuntime.contextEffect)
// #endregion
