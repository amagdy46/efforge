import { Layer, Logger } from "effect"

/**
 * The app's Effect layers. `efforge add` appends new layers to this list, so keep the
 * `Layer.mergeAll(...)` call shape.
 */
export const AppLayer = Layer.mergeAll(
  Logger.layer([Logger.consolePretty()]),
  /* efforge:layers */
)
