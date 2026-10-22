# Status and limits

v0.1 is the first release, and the CLI's options may still change.

- Cloudflare is the only runtime.
- You can add add-ons but not remove them, and a single-choice slot only moves from `none` to a value. To switch from Postgres to D1, create a new project.
- Third-party add-ons aren't supported yet, and the `efforge.jsonc` and add-on manifest formats aren't stable.
- `infra=alchemy` uses Alchemy 2.0 beta (`2.0.0-beta.83`). Drizzle is pinned to `1.0.0-rc.5-5935859` ([why](decisions/0002-drizzle-rc-pin.md)).
- With `infra=alchemy`, local secrets are read from `.env`, not `.dev.vars`, and `pnpm db:migrate` on D1 still expects a `wrangler.jsonc`. Both are known v0.1 gaps.
- CI generates, installs and runs the full gate (typecheck, check, test, build) for a matrix of 15 stacks, not every combination.
- With `--auth=none`, the `effect-ai-byok` demo server function is not gated, so anyone who can reach the app can spend the configured API key. Add auth or remove the demo before deploying.
- The generated `.dev.vars` sets `BETTER_AUTH_URL=http://localhost:5173`. If Vite picks another port because 5173 is busy, sign-up fails with `INVALID_ORIGIN`; update the variable or free the port.
