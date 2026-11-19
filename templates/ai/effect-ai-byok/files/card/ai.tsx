import { type SubmitEvent, useCallback, useEffect, useRef, useState } from "react"
import { FailureNote, Pending } from "@/components/demo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { asFailure } from "@/lib/failure"
import { type AnswerPart, askModel } from "@/server/ai-demo"
import type { Failure } from "@/server/outcome"
import program from "../../../../packages/core/src/llm.ts?region=card"
import serverFn from "../server/ai-demo.ts?region=card"
import type { Capability } from "./types"

type Answer =
  | { readonly status: "idle" }
  | { readonly status: "waiting" }
  | { readonly status: "streaming"; readonly text: string }
  | { readonly status: "done"; readonly text: string }
  | { readonly status: "failed"; readonly text: string; readonly error: Failure }

/** `LlmNotConfigured` (no key saved, no organization) is a "not configured" state like any other. */
const shown = (error: Failure): Failure =>
  error._tag === "LlmNotConfigured" ? { _tag: "NotConfigured", message: error.message } : error

/** Asks the model and reads its answer as it streams in. */
function useAnswer() {
  const [answer, setAnswer] = useState<Answer>({ status: "idle" })
  // bumped by each new question and on unmount, so an old stream stops writing
  const current = useRef(0)
  useEffect(
    () => () => {
      current.current += 1
    },
    [],
  )

  const ask = useCallback(async (prompt: string) => {
    current.current += 1
    const asked = current.current
    setAnswer({ status: "waiting" })
    const outcome = await askModel({ data: { prompt } }).catch((error: unknown) => ({
      ok: false as const,
      error: asFailure(error),
    }))
    if (asked !== current.current) return false
    if (!outcome.ok) {
      setAnswer({ status: "failed", text: "", error: outcome.error })
      return false
    }
    const reader = outcome.value.getReader()
    const read = async (text: string): Promise<void> => {
      const next: ReadableStreamReadResult<AnswerPart> = await reader
        .read()
        .catch((error: unknown) => ({ done: false, value: { failure: asFailure(error) } }))
      if (asked !== current.current) return void reader.cancel()
      if (next.done) return setAnswer({ status: "done", text })
      if ("failure" in next.value)
        return setAnswer({ status: "failed", text, error: next.value.failure })
      const more = text + next.value.text
      setAnswer({ status: "streaming", text: more })
      return read(more)
    }
    await read("")
    return true
  }, [])

  return { answer, ask }
}

function AiDemo() {
  const [prompt, setPrompt] = useState("In one sentence, what is an Effect layer?")
  const { answer, ask } = useAnswer()
  const busy = answer.status === "waiting" || answer.status === "streaming"

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    void ask(prompt)
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-2">
        <Label htmlFor="ai-prompt">Prompt</Label>
        <div className="flex gap-2">
          <Input
            id="ai-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={4000}
          />
          <Button type="submit" disabled={busy}>
            Ask
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Clear the prompt to see <code className="font-mono">EmptyPrompt</code> come back. Each
          answer is a paid call to your provider, with your key.
        </p>
      </form>
      <div aria-live="polite" className="space-y-3">
        {answer.status === "idle" ? (
          <p className="text-sm text-muted-foreground">
            The button calls a server function that runs the <code className="font-mono">ask</code>{" "}
            program through the <code className="font-mono">Llm</code> service; the answer streams
            back as the model writes it.
          </p>
        ) : null}
        {answer.status === "waiting" ? <Pending>Waiting for the model…</Pending> : null}
        {answer.status !== "idle" && answer.status !== "waiting" && answer.text !== "" ? (
          <p className="rounded-md border bg-background p-3 text-sm whitespace-pre-wrap">
            {answer.text}
            {answer.status === "streaming" ? (
              <span aria-hidden className="ml-0.5 animate-pulse">
                ▍
              </span>
            ) : null}
          </p>
        ) : null}
        {answer.status === "done" ? (
          <p className="text-sm text-muted-foreground">
            Streamed from the model through the <code className="font-mono">Llm</code> service, a
            piece at a time.
          </p>
        ) : null}
        {answer.status === "failed" ? <FailureNote error={shown(answer.error)} /> : null}
      </div>
    </div>
  )
}

export const ai: Capability = {
  id: "ai",
  title: "AI",
  summary:
    "A language model behind the Llm service, on Effect AI with your own key: ask, and read the answer as it streams.",
  layer: { name: "LlmLive", provides: ["Llm"], needs: ["LLM_* settings"] },
  code: [
    { path: "packages/core/src/llm.ts", source: program },
    { path: "apps/web/src/server/ai-demo.ts", source: serverFn },
  ],
  files: [
    ["Service and program", "packages/core/src/llm.ts"],
    ["Providers", "apps/web/src/server/llm-provider.ts"],
    ["Layer", "apps/web/src/server/llm.ts"],
  ],
  test: {
    path: "packages/core/test/llm.test.ts",
    name: "refuses a blank prompt with EmptyPrompt and never calls the model",
  },
  agents: "AI (Effect AI, bring your own key)",
  access: {
    effect: "spends",
    open: "This project has no auth, so anyone who can reach it can call askModel and spend your key. Add auth before you deploy it.",
    signedIn:
      "askModel spends your key for whoever calls it. Sign-up is open to anyone until you close it (AGENTS.md, Auth). Close it, or remove this demo, before you deploy with a real key.",
  },
  Demo: AiDemo,
}
