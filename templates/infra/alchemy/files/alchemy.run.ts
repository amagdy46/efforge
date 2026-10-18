import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Effect from "effect/Effect"

/**
 * Infrastructure as Effects (Alchemy v2). Run it with:
 *
 *   pnpm dev                          local: Vite + workerd via `alchemy dev` (stage dev_$USER)
 *   pnpm run deploy --stage prod      `alchemy deploy` to Cloudflare (or set $ALCHEMY_STAGE)
 *   pnpm run destroy --stage prod     `alchemy destroy`
 *
 * Every Cloudflare binding of the Worker lives here, in the `env` object of the website below.
 * `efforge add` appends resources above the marker and binds them by the name effect-cf reads
 * (HYPERDRIVE, DB, STORAGE, ROOM, ...), so app code never changes between wrangler and Alchemy.
 */
export default Alchemy.Stack(
  "app",
  {
    providers: Cloudflare.providers(),
    // CI shares state through a Cloudflare-hosted store; locally it is a `.alchemy/` folder.
    state: process.env.CI ? Cloudflare.state() : Alchemy.localState(),
  },
  Effect.gen(function* () {
    // efforge:resources

    // TanStack Start on Workers + static assets. The Worker entry is `src/server.ts`, which also
    // re-exports the Durable Object and Workflow classes that Cloudflare needs on the entry.
    const web = yield* Cloudflare.Website.Vite("web", {
      rootDir: "apps/web",
      main: "src/server.ts",
      env: {},
    })

    return { url: web.url.as<string>() }
  }),
)
