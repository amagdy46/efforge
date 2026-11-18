import { DatabaseLayer } from "@repo/db"
import { Layer, Logger } from "effect"
import { AuthLive } from "./auth-live"
import { WorkerEnvLive } from "./cloudflare"

/**
 * The app's Effect layers. `efforge add` appends new layers to this list, so keep the
 * `Layer.mergeAll(...)` call shape.
 */
export const AppLayer = Layer.mergeAll(
  Logger.layer([Logger.consolePretty()]),
  DatabaseLayer.pipe(Layer.provide(WorkerEnvLive)),
  AuthLive,
  /* efforge:layers */
)
