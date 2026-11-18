import { Container } from "@cloudflare/containers"

/**
 * Runs the image built from `apps/browser/Dockerfile`. Cloudflare starts it on the first request
 * and stops it after `sleepAfter` without traffic. Bound as BROWSER (wrangler.jsonc or infra/alchemy.run.ts) and exported
 * from `src/server.ts`.
 *
 * Locally the container runs in Docker. With wrangler, `pnpm dev` starts no container until you set
 * `dev.enable_containers` to true in wrangler.jsonc (so the app starts without Docker); until then
 * Browser calls fail with `BrowserUnavailable`, which the dashboard card shows with what to do.
 */
export class BrowserContainer extends Container {
  defaultPort = 8080
  sleepAfter = "5m"
}
