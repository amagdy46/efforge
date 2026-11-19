import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"
import { RpcHandler } from "@/server/rpc"
import { runtime } from "@/server/runtime"

/**
 * POST /api/rpc: the app's Effect RPC group (server/rpc.ts), on the app's
 * runtime. With auth, `/api/` needs a session (server/api-session.ts).
 */
export const Route = createFileRoute("/api/rpc")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runtime.runPromise(Effect.service(RpcHandler)).then((handle) => handle(request)),
    },
  },
})
