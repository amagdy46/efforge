# Status and limits

efforge is young, and the CLI's options may still change.

- Cloudflare is the only runtime.
- You can add add-ons but not remove them, and a single-choice slot only moves from `none` to a value. To switch from Postgres to D1, create a new project.
- Third-party add-ons aren't supported yet, and the add-on manifest format (`addon.json`) isn't stable.
- `efforge.jsonc` has a JSON Schema (`schemas/efforge.schema.json`, linked from the file's `$schema`). What is promised: `stack` and its values mean what the schema says, and a newer efforge reads an `efforge.jsonc` written by an older one. What isn't: the `files` hashes are internal and may change format, and new fields may appear.
- The `--json` output is versioned (`contract` in every document, see [json.md](json.md)): within one contract version, fields and error codes keep their names and meanings. The text output for people may change at any time.
- `infra=alchemy` uses Alchemy 2.0 beta (`2.0.0-beta.87`). Drizzle is pinned to the `1.0.0-rc.5` release candidate ([why](decisions/0002-drizzle-rc-pin.md)).
- Generated projects pin every Effect package to one version with `overrides` in `pnpm-workspace.yaml` ([why](decisions/0005-effect-lockstep-overrides.md)). The wildcard entries need pnpm 12.17 or later; the project's `packageManager` field pins 12.21.0, and pnpm switches to it on its own. When you upgrade `effect`, change the catalog entry and the overrides together.
- With `infra=alchemy`, local secrets are read from `.env`, not `.dev.vars`, and `pnpm db:migrate` on D1 still expects a `wrangler.jsonc`. Both are known gaps.
- CI generates, installs and runs the full gate (typecheck, check, test, build) for a matrix of 15 stacks, not every combination.
- With `--auth=none`, the `effect-ai-byok` demo server function is not gated, so anyone who can reach the app can spend the configured API key. Add auth or remove the demo before deploying.
- The generated `.dev.vars` sets `BETTER_AUTH_URL=http://localhost:5173`. If Vite picks another port because 5173 is busy, sign-up fails with `INVALID_ORIGIN`; update the variable or free the port.
