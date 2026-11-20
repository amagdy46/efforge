import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"

// The `rpc` add-on's route (apps/web/src/routes/api/rpc.ts), loaded from the template with its
// imports replaced by stubs. The runtime is Postgres's: it builds the layers for each call and
// closes them when the call returns. A stream writes its later parts after the route has
// answered, so the route must keep the call open until the body has been read.

const repo = new URL("..", import.meta.url).pathname
const cache = join(repo, "node_modules/.cache")
mkdirSync(cache, { recursive: true })
const tmp = mkdtempSync(join(cache, "efforge-rpc-route-"))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const write = (name: string, source: string) => {
  const file = join(tmp, `${name}-${Math.random().toString(36).slice(2)}.ts`)
  writeFileSync(file, source)
  return file
}

/** The server module the route imports, with a runtime that closes its layer after each call. */
const stub = `
import { Context, Effect, Layer } from "effect"

export class RpcHandler extends Context.Service<
  RpcHandler,
  (request: Request) => Promise<Response>
>()("RpcHandler") {}

/** Whether the layers are open, and what happened, in order. */
export const state = { open: false, log: [] as string[], missing: undefined as unknown }

/** A stream of three lines, each made when it is read: the later ones after the route answered. */
const handle = (_: Request) => {
  let n = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      n++
      controller.enqueue(new TextEncoder().encode(n + ":" + (state.open ? "open" : "closed") + "\\n"))
      if (n === 3) controller.close()
    },
  })
  return Promise.resolve(new Response(body, { headers: { "content-type": "application/ndjson" } }))
}

const Live = Layer.effect(
  RpcHandler,
  Effect.acquireRelease(
    Effect.sync(() => {
      state.open = true
      return RpcHandler.of(handle)
    }),
    () => Effect.sync(() => {
      state.open = false
      state.log.push("closed")
    }),
  ),
)

export const runtime = {
  runPromise: <A, E>(effect: Effect.Effect<A, E, RpcHandler>): Promise<A> =>
    state.missing === undefined
      ? Effect.runPromise(Effect.provide(effect, Live))
      : Promise.reject(state.missing),
}

export const asNotConfigured = (error: any) =>
  error?._tag === "NotConfigured" ? error : undefined
`

type State = { open: boolean; log: Array<string>; missing: unknown }
type Post = (args: { request: Request }) => Promise<Response>

const load = async (source = "templates/extras/rpc/files/routes/rpc.ts") => {
  const server = write("server", stub)
  const route = readFileSync(join(repo, source), "utf8")
    .replace(
      /^import \{ createFileRoute \} from .*$/m,
      "const createFileRoute = (_: string) => (route: unknown) => route",
    )
    .replace(
      /^import \{ RpcHandler \} from .*$/m,
      `import { RpcHandler } from ${JSON.stringify(server)}`,
    )
    .replace(/^import \{ runtime \} from .*$/m, `import { runtime } from ${JSON.stringify(server)}`)
    .replace(
      /^import \{ asNotConfigured \} from .*$/m,
      `import { asNotConfigured } from ${JSON.stringify(server)}`,
    )
  const { Route } = (await import(write("route", route))) as {
    Route: { server: { handlers: { POST: Post } } }
  }
  const { state } = (await import(server)) as { state: State }
  const post = () => Route.server.handlers.POST({ request: new Request("http://app.test/api/rpc") })
  return { post, state }
}

describe("POST /api/rpc on a runtime that closes its layers when a call returns", () => {
  it("keeps the layers open until the answer's body has been read to the end", async () => {
    const { post, state } = await load()
    const response = await post()
    expect(state.open).toBe(true)
    expect(await response.text()).toBe("1:open\n2:open\n3:open\n")
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(state.open).toBe(false)
    expect(state.log).toEqual(["closed"])
  })

  it("closes them when the browser goes away mid-stream", async () => {
    const { post, state } = await load()
    const reader = (await post()).body?.getReader()
    expect(new TextDecoder().decode((await reader?.read())?.value)).toBe("1:open\n")
    await reader?.cancel()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(state.log).toEqual(["closed"])
  })

  it("answers a missing setting with 503 and NotConfigured, naming it", async () => {
    const { post, state } = await load()
    const missing = {
      _tag: "NotConfigured",
      setting: "LLM_API_KEY",
      file: ".dev.vars",
      problem: "LLM_API_KEY is not set.",
      message: "LLM_API_KEY is not set. Set LLM_API_KEY in .dev.vars and restart pnpm dev.",
    }
    state.missing = missing
    const response = await post()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual(missing)
  })
})
