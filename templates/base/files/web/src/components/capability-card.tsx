import type { Capability } from "@/capabilities/types"
import { CodeBlock } from "@/components/code-block"
import { cn } from "@/lib/utils"

/** The tempering colours, in order; a card takes the colour of its layer in the layer graph. */
export const temperClasses = ["bg-temper-1", "bg-temper-2", "bg-temper-3", "bg-temper-4"] as const

function Path({ children }: { children: string }) {
  return <code className="font-mono text-[0.8rem] break-all text-foreground">{children}</code>
}

/** One capability: its demo next to its code, then the files, test and docs to read next. */
export function CapabilityCard({
  capability,
  tone,
}: {
  capability: Capability
  /** index into the tempering colours, or undefined for a capability without a layer */
  tone: number | undefined
}) {
  const { id, title, summary, layer, code, files, test, agents, Demo } = capability
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-6 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-5 py-4">
        <span
          aria-hidden
          className={cn(
            "size-3 shrink-0 rounded-[3px] ring-1 ring-foreground/15",
            tone === undefined ? "bg-muted" : temperClasses[tone % temperClasses.length],
          )}
        />
        <h2 id={`${id}-title`} className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        {layer === undefined ? null : (
          <p className="text-sm text-muted-foreground">
            <span className="sr-only">Services: </span>
            {layer.provides.map((service) => (
              <code
                key={service}
                className="mr-1.5 rounded border bg-background px-1.5 py-0.5 font-mono text-xs text-foreground"
              >
                {service}
              </code>
            ))}
          </p>
        )}
        <p className="basis-full text-sm text-muted-foreground">{summary}</p>
      </header>
      <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-4 p-5">
          <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Try it
          </h3>
          <Demo />
        </div>
        <div className="max-h-[26rem] min-w-0 border-t bg-code lg:max-h-none lg:border-t-0 lg:border-l">
          <CodeBlock files={code} />
        </div>
      </div>
      <footer className="border-t bg-muted/40 px-5 py-4">
        <h3 className="sr-only">Where to go next</h3>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
          {files.map(([what, path]) => (
            <div key={path} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{what}</dt>
              <dd>
                <Path>{path}</Path>
              </dd>
            </div>
          ))}
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Test with a test layer</dt>
            <dd>
              <Path>{test.path}</Path>
              <span className="block text-xs text-muted-foreground">“{test.name}”</span>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Rules for agents</dt>
            <dd>
              <Path>AGENTS.md</Path> <span className="text-muted-foreground">§ {agents}</span>
            </dd>
          </div>
        </dl>
      </footer>
    </section>
  )
}
