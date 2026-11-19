# Status and limits

efforge is young, and the CLI's options may still change.

- Cloudflare is the only runtime.
- You can add add-ons but not remove them, and a single-choice slot only moves from `none` to a value. To switch from Postgres to D1, create a new project.
- Third-party add-ons aren't supported yet, and the add-on manifest format (`addon.json`) isn't stable.
- `efforge.jsonc` has a JSON Schema (`schemas/efforge.schema.json`, linked from the file's `$schema`). What is promised: `stack` and its values mean what the schema says, and a newer efforge reads an `efforge.jsonc` written by an older one. What isn't: the `files` hashes are internal and may change format, and new fields may appear.
- The `--json` output is versioned (`contract` in every document, see [json.md](json.md)): within one contract version, fields and error codes keep their names and meanings. The text output for people may change at any time.
- `infra=alchemy` uses Alchemy 2.0 beta (`2.0.0-beta.87`). Drizzle is pinned to the `1.0.0-rc.5` release candidate ([why](decisions/0002-drizzle-rc-pin.md)).
- Generated projects pin every Effect package to one version with `overrides` in `pnpm-workspace.yaml` ([why](decisions/0005-effect-lockstep-overrides.md)). The wildcard entries need pnpm 12.17 or later; the project's `packageManager` field pins 12.21.0, and pnpm switches to it on its own. When you upgrade `effect`, change the catalog entry and the overrides together. The `effect` entry only covers Effect 4, so a library that depends on Effect 3 (uploadthing, Prisma) keeps its own copy. The family wildcards are not scoped that way: `@effect/ai-google`, `@effect/sql-drizzle` and `@effect/sql-kysely` have no Effect 4 release, so they can't be installed alongside the overrides.
- A project made by efforge 0.2.0 has no overrides and pins pnpm 12.4.2, so it can install two Effect versions and fail `pnpm build` with `failed to resolve import "effect/..."`. `upgrade` repairs it, and so does any `efforge add` from 0.2.1; [Keep a project current](upgrading.md#without-the-new-cli) has the repair by hand.
- With `infra=alchemy`, local settings live in `.env` (`alchemy dev` reads it) instead of `.dev.vars`; efforge writes them there at `create` and at every `add`. On D1, `pnpm dev` and `pnpm run deploy` apply the migrations; `pnpm db:migrate` needs a `wrangler.jsonc` and says so.
- CI generates, installs and runs the full gate (typecheck, check, test, build) for a matrix of 17 stacks (the three presets among them), not every combination.
- With `--auth=none`, the `effect-ai-byok` demo server function is not gated, so anyone who can reach the app can spend the configured API key. Add auth or remove the demo before deploying.
