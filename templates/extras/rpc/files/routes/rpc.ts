import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"
import { RpcHandler } from "@/server/rpc"
import { runtime } from "@/server/runtime"
import { asNotConfigured } from "@/server/settings"

/**
 * `response` with a body that calls `done` once it has been read to the end,
 * failed or been cancelled (the browser went away).
 */
const untilRead = (response: Response, done: () => void): Response => {
  const reader = response.body?.getReader()
  if (reader === undefined) {
    done()
    return response
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (chunk.done) {
          controller.close()
          done()
        } else controller.enqueue(chunk.value)
      } catch (error) {
        controller.error(error)
        done()
      }
    },
    cancel(reason) {
      done()
      return reader.cancel(reason)
    },
  })
  return new Response(body, response)
}

/**
 * POST /api/rpc: the app's Effect RPC group (server/rpc.ts), on the app's
 * runtime. The answer is sent as soon as RPC has one, but the runtime call
 * lasts until its body has been read: a stream writes its later parts after
 * that, and on Postgres the runtime closes AppLayer (and its database
 * connection) when the call returns. So a stream's handler may use any
 * service. A missing setting is a 503 naming it, which the client turns into
 * `NotConfigured`. With auth, `/api/` needs a session (server/api-session.ts).
 */
export const Route = createFileRoute("/api/rpc")({
  server: {
    handlers: {
      POST: ({ request }) =>
        new Promise<Response>((answer, fail) => {
          runtime
            .runPromise(
              RpcHandler.use((handle) =>
                Effect.promise(async () => {
                  const response = await handle(request)
                  await new Promise<void>((read) => answer(untilRead(response, read)))
                }),
              ),
            )
            .catch((error: unknown) => {
              const missing = asNotConfigured(error)
              if (missing === undefined) {
                fail(error)
                return
              }
              const { setting, file, problem, message } = missing
              answer(
                Response.json(
                  { _tag: "NotConfigured", setting, file, problem, message },
                  { status: 503 },
                ),
              )
            })
        }),
    },
  },
})
