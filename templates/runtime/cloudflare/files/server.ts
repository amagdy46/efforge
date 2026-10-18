import handler from "@tanstack/react-start/server-entry"
import { workerRoutes } from "./server/routes"

/**
 * The Worker entry (`main` in wrangler.jsonc). Cloudflare requires Durable Object and Workflow
 * classes to be exported from here: `efforge add` appends their re-exports to the end of this file.
 */
export default {
  async fetch(request: Request) {
    for (const route of workerRoutes) {
      const response = await route(request)
      if (response !== undefined) return response
    }
    return handler.fetch(request)
  },
}
