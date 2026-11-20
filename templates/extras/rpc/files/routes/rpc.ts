import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"
import { RpcHandler } from "@/server/rpc"
import { runtime } from "@/server/runtime"

/**
 * POST /api/rpc: the app's Effect RPC group (server/rpc.ts), on the app's
 * runtime. The request is answered inside the runtime call: on Postgres the
 * runtime builds AppLayer per call and closes it after. With auth, `/api/`
 * needs a session (server/api-session.ts).
 */
export const Route = createFileRoute("/api/rpc")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runtime.runPromise(RpcHandler.use((handle) => Effect.promise(() => handle(request)))),
    },
  },
})
