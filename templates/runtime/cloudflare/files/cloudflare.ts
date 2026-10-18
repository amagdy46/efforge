import { env } from "cloudflare:workers"
import { Layer } from "effect"
import { WorkerEnvironment } from "effect-cf"

/** Gives effect-cf binding layers the Worker `env`. App code reads bindings only through those layers. */
export const CloudflareEnv = Layer.succeed(WorkerEnvironment, env)
