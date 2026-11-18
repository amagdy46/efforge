import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowRight, Check, Copy } from "lucide-react"
import { type ReactNode, useState } from "react"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { PROJECT_NAME } from "@/lib/project"
import { describeStack, nextAdd, stackItems } from "@/lib/stack"
import { getStack } from "@/server/stack"

// This page is yours to replace: the dashboard lives in routes/app, and nothing else imports this file.
export const Route = createFileRoute("/")({
  loader: () => getStack(),
  component: Landing,
})

function Command({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () =>
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  return (
    <div className="flex items-center gap-2 rounded-md border bg-code py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-sm text-code-foreground">
        <span aria-hidden className="text-muted-foreground select-none">
          ${" "}
        </span>
        {command}
      </code>
      <Button variant="ghost" size="icon" onClick={copy} aria-label="Copy the command">
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
  )
}

/** efforge's mark, for the "made with" line. */
function EfforgeMark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className="size-4">
      <path fill="#2F5AA8" d="M20 0H64V48L48 64H0V20Z" />
      <path
        fill="#F6F5F1"
        fillRule="evenodd"
        d="M12 56H28L36 48H16V44H40V56H48V44H56V36H48V16L56 8H44A4 4 0 0 0 40 12V36H32V24A4 4 0 0 0 28 20H12A4 4 0 0 0 8 24V52A4 4 0 0 0 12 56ZM16 28H24V36H16Z"
      />
    </svg>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 border-t py-5 first:border-t-0">
      <span
        aria-hidden
        className="flex size-7 items-center justify-center rounded-full border font-mono text-xs text-muted-foreground"
      >
        {n}
      </span>
      <div className="space-y-2">
        <h2 className="font-semibold tracking-tight">{title}</h2>
        {children}
      </div>
    </li>
  )
}

function Landing() {
  const { stack, cards } = Route.useLoaderData()
  const items = stackItems(stack, cards)
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-4 sm:px-6">
        <img src="/favicon.svg" alt="" className="size-7" />
        <span className="font-semibold">{PROJECT_NAME}</span>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Button asChild>
            <Link to="/app">Dashboard</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-10 px-4 pt-8 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-16 lg:pt-16">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight break-words sm:text-5xl">
            {PROJECT_NAME}
          </h1>
          <p className="mt-5 max-w-xl text-lg text-pretty">
            {PROJECT_NAME} is {describeStack(stack)} Its server code is written with Effect: each
            capability is a service in <code className="font-mono text-[0.9em]">packages/core</code>
            , a layer implements it, and one file composes the layers.
          </p>

          <ol className="mt-8 max-w-xl">
            <Step n={1} title="See each capability working">
              <p className="text-sm text-muted-foreground">
                The dashboard runs a small demo of every capability next to the code behind it.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link to="/app">
                  Open the dashboard <ArrowRight aria-hidden />
                </Link>
              </Button>
            </Step>
            <Step n={2} title="Read AGENTS.md">
              <p className="text-sm text-muted-foreground">
                <code className="font-mono text-foreground">AGENTS.md</code>, at the root of the
                repo, has the rules this codebase follows: where services live, how errors and tests
                work. Coding agents read it first; so can you.
              </p>
            </Step>
            <Step n={3} title="Add a capability">
              <p className="text-sm text-muted-foreground">
                efforge wires it in and adds its card to the dashboard.
              </p>
              <Command command={nextAdd(stack)} />
            </Step>
          </ol>
        </div>

        <aside
          aria-labelledby="stack-title"
          className="self-start rounded-xl border bg-card shadow-xs"
        >
          <div className="border-b px-5 py-4">
            <h2 id="stack-title" className="font-semibold tracking-tight">
              Stack
            </h2>
            <p className="text-sm text-muted-foreground">What this project was created with.</p>
          </div>
          <dl className="divide-y">
            {items.map((item, i) => (
              <div
                key={`${item.slot}-${item.label ?? i}`}
                className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 px-5 py-3"
              >
                <dt className="pt-px text-xs font-medium tracking-wider text-muted-foreground uppercase">
                  {item.slot}
                </dt>
                <dd className="min-w-0">
                  {item.label === undefined ? (
                    <span className="text-sm text-muted-foreground">None</span>
                  ) : (
                    <>
                      {item.card === undefined ? (
                        <span className="text-sm font-medium">{item.label}</span>
                      ) : (
                        <a
                          href={`/app#${item.card}`}
                          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {item.label}
                        </a>
                      )}
                      {item.path === undefined ? null : (
                        <code className="block truncate font-mono text-xs text-muted-foreground">
                          {item.path}
                        </code>
                      )}
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </aside>
      </main>

      <footer className="border-t">
        <p className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
          <EfforgeMark />
          <span>
            Made with{" "}
            <a
              href="https://github.com/amagdy46/efforge"
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              efforge
            </a>
          </span>
        </p>
      </footer>
    </div>
  )
}
