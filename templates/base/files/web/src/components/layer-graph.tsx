import type { Capability } from "@/capabilities/types"
import { temperClasses } from "@/components/capability-card"
import type { LayerEntry } from "@/lib/layer-graph"
import { cn } from "@/lib/utils"

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
        <ol className="grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
          {layers.map((layer, i) => {
            const info = capabilities.find((c) => c.layer?.name === layer.name)?.layer
            const needs = [...layer.provided, ...(info?.needs ?? [])]
            return (
              <li key={layer.name} className="overflow-hidden rounded-md border bg-background">
                <div aria-hidden className={cn("h-1.5", temperClasses[i % temperClasses.length])} />
                <div className="space-y-2 p-3">
                  <p className="font-mono text-sm font-semibold break-all">{layer.name}</p>
                  <dl className="space-y-1 text-xs">
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">provides</dt>
                      <dd className="font-mono break-all">
                        {info === undefined ? "see layers.ts" : info.provides.join(", ")}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">needs</dt>
                      <dd className="font-mono break-all">
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
