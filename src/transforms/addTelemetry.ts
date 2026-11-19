import { Effect } from "effect"
import {
  addImportText,
  appendListItem,
  mergeAllOf,
  missing,
  parseTs,
  req,
  type Transform,
  withFile,
} from "./util.ts"

const norm = (s: string) => s.replace(/\s+/g, "")

/**
 * args: `{ file, import, from, layer }`: adds `layer` to `TelemetryLive = Layer.mergeAll(...)`, the
 * slot layers.ts provides underneath AppLayer (`.pipe(Layer.provideMerge(TelemetryLive))`), so a
 * tracer or an exporter reaches every layer and what they fork while they build. A tracer added to
 * AppLayer's own list would miss those fibers.
 */
export const addTelemetry: Transform = (tree, args) =>
  Effect.gen(function* () {
    const file = req(args, "file", "addTelemetry")
    const spec = req(args, "import", "addTelemetry")
    const from = req(args, "from", "addTelemetry")
    const layer = req(args, "layer", "addTelemetry")
    const snippet = `In ${file}:\n  import { ${spec} } from "${from}"\n  export const TelemetryLive = Layer.mergeAll(Layer.empty, ${layer})\n  export const AppLayer = Layer.mergeAll(/* ... */).pipe(Layer.provideMerge(TelemetryLive))`
    const text = tree.get(file)
    if (text === undefined) return yield* missing(file, "file", snippet)
    const call = mergeAllOf(parseTs(file, text), "TelemetryLive")
    if (call === undefined)
      return yield* missing(file, "TelemetryLive = Layer.mergeAll(...) under AppLayer", snippet)
    const callArgs = call.getArguments()
    let next = text
    if (!callArgs.some((a) => norm(a.getText()) === norm(layer))) {
      const open = text.indexOf("(", call.getExpression().getEnd())
      next = appendListItem(text, open, call.getEnd() - 1, callArgs.at(-1)?.getEnd(), layer)
    }
    next = addImportText(file, next, spec, from) ?? next
    return withFile(tree, file, next)
  })
