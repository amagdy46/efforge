import type { Capability } from "@/capabilities/types"
import { temperClasses } from "@/components/capability-card"
import { type LayerEntry, rowSizes } from "@/lib/layer-graph"
import { cn } from "@/lib/utils"

// a row of n layers on the 6-column (sm) and 12-column (xl) grids: each layer spans 6/n or 12/n
const smSpan: Record<number, string> = {
  1: "sm:col-span-6",
  2: "sm:col-span-3",
  3: "sm:col-span-2",
}
const xlSpan: Record<number, string> = {
  1: "xl:col-span-12",
  2: "xl:col-span-6",
  3: "xl:col-span-4",
  4: "xl:col-span-3",
}

/** For each layer, the size of the row it lands in when rows hold at most `columns`. */
const rowOf = (count: number, columns: number): number[] =>
  rowSizes(count, columns).flatMap((size) => Array.from({ length: size }, () => size))

/**
 * `AppLayer` and the layers it merges, each in its tempering colour, with the services it provides
 * and what it needs. The diagram is a list, so screen readers and agents read the same facts.
 */
export function LayerGraph({
  layers,
  capabilities,
}: {
  layers: ReadonlyArray<LayerEntry>
  capabilities: ReadonlyArray<Capability>
}) {
  // rows of up to three layers from sm, four from xl, with no layer alone on a row
  const sm = rowOf(layers.length, 3)
  const xl = rowOf(layers.length, 4)
  return (
    <section
      aria-labelledby="layer-graph-title"
      className="rounded-xl border bg-card p-5 shadow-xs"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="layer-graph-title" className="text-base font-semibold tracking-tight">
          Layer graph
        </h2>
        <p className="font-mono text-xs text-muted-foreground">apps/web/src/server/layers.ts</p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Server functions run on <code className="font-mono text-foreground">AppLayer</code>, which
        merges {layers.length} {layers.length === 1 ? "layer" : "layers"}. Each provides services;
        what it needs comes from the Worker's bindings and settings.
      </p>
      <div className="mt-4 rounded-lg border border-dashed p-3">
        <p className="mb-3 font-mono text-xs font-medium">
          AppLayer <span className="text-muted-foreground">= Layer.mergeAll(</span>
        </p>
        <ol className="grid gap-3 sm:grid-cols-6 xl:grid-cols-12">
          {layers.map((layer, i) => {
            const info = capabilities.find((c) => c.layer?.name === layer.name)?.layer
            const needs = [...layer.provided, ...(info?.needs ?? [])]
            return (
              <li
                key={layer.name}
                className={cn(
                  "overflow-hidden rounded-md border bg-background",
                  smSpan[sm[i] ?? 1],
                  xlSpan[xl[i] ?? 1],
                )}
              >
                <div aria-hidden className={cn("h-1.5", temperClasses[i % temperClasses.length])} />
                <div className="space-y-2 p-3">
                  <p className="font-mono text-sm font-semibold break-all">{layer.name}</p>
                  <dl className="space-y-1 text-xs">
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">provides</dt>
                      <dd className="font-mono break-words">
                        {info === undefined ? "see layers.ts" : info.provides.join(", ")}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">needs</dt>
                      <dd className="font-mono break-words">
                        {needs.length === 0 ? "nothing" : needs.join(", ")}
                      </dd>
                    </div>
                  </dl>
                </div>
              </li>
            )
          })}
        </ol>
        <p className="mt-3 font-mono text-xs text-muted-foreground">)</p>
      </div>
    </section>
  )
}
