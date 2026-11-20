import { setInitializer } from "@effect/platform-cloudflare/CloudflareDurableObjects"
import { runtime } from "../server/runtime"

/*
 * The cluster's Durable Object classes, re-exported from `src/server.ts`
 * (Cloudflare finds them on the Worker entry). Each object waits for the app's
 * runtime before it handles a request or an alarm: that build registers the
 * entity and workflow handlers (`ClusterLive` in AppLayer).
 *
 * `setInitializer` may be called once per isolate, but `pnpm dev` evaluates
 * this module again after an edit, so the first call is kept and reads the
 * newest runtime. Restart `pnpm dev` after changing a handler: a Durable
 * Object keeps the handlers it started with.
 */
const shared = globalThis as typeof globalThis & {
  clusterRuntime?: typeof runtime
  clusterInitialized?: boolean
}
shared.clusterRuntime = runtime
if (shared.clusterInitialized !== true) {
  shared.clusterInitialized = true
  setInitializer(() => (shared.clusterRuntime ?? runtime).context())
}

export {
  ClusterDurableQueue,
  ClusterEntity,
  ClusterSingleton,
  ClusterWorkflow,
} from "@effect/platform-cloudflare/CloudflareDurableObjects"
