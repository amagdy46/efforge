import { Layer, Logger } from "effect"

// #region card
/**
 * Telemetry (a tracer, an exporter), underneath every layer in AppLayer, so
 * what a layer forks while it builds is traced too. Empty until an add-on
 * puts one here.
 */
export const TelemetryLive = Layer.mergeAll(Layer.empty /* efforge:telemetry */)

/**
 * The app's Effect layers. `efforge add` appends new layers to this list,
 * so keep the `Layer.mergeAll(...)` call shape.
 */
export const AppLayer = Layer.mergeAll(
  Logger.layer([Logger.consolePretty()]),
  /* efforge:layers */
).pipe(Layer.provideMerge(TelemetryLive))
// #endregion
