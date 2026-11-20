import { setInitializer } from "@effect/platform-cloudflare/CloudflareDurableObjects"
import { clusterRuntime } from "../server/cluster"

/*
 * The cluster's Durable Object classes, re-exported from `src/server.ts`
 * (Cloudflare finds them on the Worker entry). Each object waits for the
 * cluster's runtime before it handles a request or an alarm: that build
 * registers the entity and workflow handlers (`clusterRuntime` in
 * `../server/cluster.ts`, which AppLayer shares). It is the cluster alone,
 * not AppLayer, so it is the same on every database: a per-call AppLayer
 * (Postgres) would drop the handlers when its call ends.
 *
 * `setInitializer` may be called once per isolate, but `pnpm dev` evaluates
 * this module again after an edit, so the first call is kept and reads the
 * newest runtime. Restart `pnpm dev` after changing a handler: a Durable
 * Object keeps the handlers it started with.
 */
const shared = globalThis as typeof globalThis & {
  clusterRuntime?: typeof clusterRuntime
  clusterInitialized?: boolean
}
shared.clusterRuntime = clusterRuntime
if (shared.clusterInitialized !== true) {
  shared.clusterInitialized = true
  setInitializer(() => (shared.clusterRuntime ?? clusterRuntime).context())
}

export {
  ClusterDurableQueue,
  ClusterEntity,
  ClusterSingleton,
  ClusterWorkflow,
} from "@effect/platform-cloudflare/CloudflareDurableObjects"
