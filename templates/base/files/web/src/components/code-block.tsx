import { type KeyboardEvent, useId, useMemo, useRef, useState } from "react"
import type { CodeFile } from "@/capabilities/types"
import { highlight } from "@/lib/highlight"
import { cn } from "@/lib/utils"

interface Line {
  readonly number: number
  readonly tokens: ReadonlyArray<{
    readonly at: number
    readonly kind: string
    readonly text: string
  }>
}

const toLines = (source: string): Line[] => {
  const lines: Array<{ number: number; tokens: Line["tokens"][number][] }> = [
    { number: 1, tokens: [] },
  ]
  let at = 0
  for (const token of highlight(source)) {
    token.text.split("\n").forEach((text, i) => {
      if (i > 0) {
        lines.push({ number: lines.length + 1, tokens: [] })
        at++
      }
      if (text !== "") lines.at(-1)?.tokens.push({ at, kind: token.kind, text })
      at += text.length
    })
  }
  return lines
}

function Code({ source }: { source: string }) {
  const lines = useMemo(() => toLines(source), [source])
  return (
    <pre className="overflow-x-auto py-3 font-mono text-[0.78rem] leading-6 text-code-foreground">
      <code className="grid min-w-max">
        {lines.map((line) => (
          <span key={line.number} className="grid grid-cols-[2.75rem_1fr] pr-4">
            <span aria-hidden className="pr-4 text-right text-code-foreground/35 select-none">
              {line.number}
            </span>
            <span>
              {line.tokens.map((t) => (
                <span key={t.at} className={t.kind === "plain" ? undefined : `tok-${t.kind}`}>
                  {t.text}
                </span>
              ))}
            </span>
          </span>
        ))}
      </code>
    </pre>
  )
}

/** `packages/core/src/notes.ts` -> `core/notes.ts`, `apps/web/src/server/notes.ts` -> `server/notes.ts` */
const tabName = (path: string) =>
  path.replace(/^packages\/([^/]+)\/src\//, "$1/").replace(/^apps\/[^/]+\/src\//, "")

/** Source files with syntax colouring; several become tabs. The file path is the caption. */
export function CodeBlock({ files }: { files: ReadonlyArray<CodeFile> }) {
  const [active, setActive] = useState(0)
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const id = useId()
  const file = files[active] ?? files[0]
  if (file === undefined) return null

  // one tab stop for the tab list; arrow keys, Home and End move between files
  const onKeyDown = (event: KeyboardEvent) => {
    const last = files.length - 1
    const next = {
      ArrowRight: active === last ? 0 : active + 1,
      ArrowLeft: active === 0 ? last : active - 1,
      Home: 0,
      End: last,
    }[event.key]
    if (next === undefined) return
    event.preventDefault()
    setActive(next)
    tabs.current[next]?.focus()
  }
  return (
    <figure className="flex h-full min-w-0 flex-col">
      {files.length > 1 ? (
        <div
          role="tablist"
          aria-label="Files"
          onKeyDown={onKeyDown}
          className="flex gap-1 overflow-x-auto overflow-y-hidden border-b px-2 pt-2"
        >
          {files.map((f, i) => (
            <button
              key={f.path}
              ref={(element) => {
                tabs.current[i] = element
              }}
              type="button"
              role="tab"
              tabIndex={i === active ? 0 : -1}
              id={`${id}-tab-${i}`}
              aria-selected={i === active}
              aria-controls={`${id}-panel`}
              onClick={() => setActive(i)}
              className={cn(
                "-mb-px rounded-t-md border border-transparent px-3 py-1.5 font-mono text-xs whitespace-nowrap text-muted-foreground hover:text-foreground",
                i === active && "border-border border-b-code bg-code text-foreground",
              )}
            >
              {tabName(f.path)}
            </button>
          ))}
        </div>
      ) : null}
      <figcaption className="truncate px-4 pt-3 font-mono text-xs text-muted-foreground">
        {file.path}
      </figcaption>
      <div
        id={`${id}-panel`}
        role={files.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={files.length > 1 ? `${id}-tab-${active}` : undefined}
        // the panel scrolls sideways for long lines, so it has to be reachable by keyboard
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-offset-[-2px]"
      >
        <Code source={file.source} />
      </div>
    </figure>
  )
}
