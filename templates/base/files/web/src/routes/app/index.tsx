import { createFileRoute } from "@tanstack/react-router"
import { capabilities } from "@/capabilities/registry"
import { CapabilityCard } from "@/components/capability-card"
import { LayerGraph } from "@/components/layer-graph"
import { parseAppLayer } from "@/lib/layer-graph"
import { PROJECT_NAME } from "@/lib/project"
import layersSource from "../../server/layers.ts?raw"

export const Route = createFileRoute("/app/")({
  head: () => ({ meta: [{ title: `Capabilities · ${PROJECT_NAME}` }] }),
  component: Dashboard,
})

const layers = parseAppLayer(layersSource)

/** Each capability's colour is its layer's position in the layer graph. */
const tone = (name: string | undefined) => {
  const i = layers.findIndex((layer) => layer.name === name)
  return i === -1 ? undefined : i
}

function Dashboard() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Capabilities</h1>
        <p className="max-w-3xl text-muted-foreground">
          Each card runs a real demo against this app's server, next to the Effect code behind it.
          The code is read from the files as they are, so when you change a service its card shows
          your change.
        </p>
        <nav aria-label="Capabilities" className="flex flex-wrap gap-2">
          {capabilities.map((capability) => (
            <a
              key={capability.id}
              href={`#${capability.id}`}
              className="rounded-full border bg-card px-3 py-1 text-sm hover:bg-accent"
            >
              {capability.title}
            </a>
          ))}
        </nav>
      </header>
      {capabilities.map((capability) => (
        <CapabilityCard
          key={capability.id}
          capability={capability}
          tone={tone(capability.layer?.name)}
        />
      ))}
      <LayerGraph layers={layers} capabilities={capabilities} />
    </div>
  )
}
