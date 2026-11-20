# Keep a project current

efforge keeps working for a project after it creates it. Two commands do that:

- `doctor` checks the checkout as it is now and says what is wrong, one line each, with the command that fixes it. It changes nothing.
- `upgrade` brings the project to this efforge's pins and templates, and leaves your changes alone. `upgrade --check` says what it would do, without doing it.

Run them with the newest efforge, from inside the project (or pass `--cwd`):

```sh
npx -y create-efforge@latest doctor
npx -y create-efforge@latest upgrade --check
npx -y create-efforge@latest upgrade
```

## What efforge touches, and what it leaves

efforge records what it wrote, so it can tell its files from yours.

- **A file efforge wrote**: `efforge.jsonc` keeps a hash of it. If the file still matches, it is efforge's, and `upgrade` may replace it. If you changed it, it is yours, and `upgrade` leaves it.
- **A file efforge edits in place** (`layers.ts`, `AGENTS.md`, `wrangler.jsonc`, `auth.ts`), **pins, scripts and dependencies**: efforge has a record of what each release generated. What a release wrote is efforge's to move; anything else is yours.
- **Anything without a record is yours.**

So `upgrade` never replaces a file you changed, never puts back a file you deleted, and never moves a version you pinned yourself. When a new file of efforge's needs a line in a file of yours that efforge edits in place, it adds just that line, with the same AST edits `efforge add` uses. When efforge's new version of a file would break a file of yours (your dashboard imports something the new version no longer exports), it keeps the old one, and the files that need it, and says why.

It refuses to run with uncommitted changes, so `git diff` afterwards shows exactly what it did. It writes nothing if any step fails. Then it runs `pnpm install` if dependencies changed.

## What the answers mean

`upgrade --check` puts the project in one of three states:

- **Needs action**: something breaks the project now, or will at the next install. For example, the guard that holds every Effect package at one version is missing. Most of these `upgrade` fixes; the rest come with the exact lines to change.
- **Behind**: nothing breaks, and `upgrade` has something to apply: newer pins, newer templates, new files.
- **Up to date**: nothing to apply. Files you changed that differ from efforge's templates are listed, and don't count.

Files `upgrade` keeps are listed under **Kept**, each with a reason:

- `yours`: you changed the file, and efforge's template changed too. Read efforge's version with `npx -y create-efforge@latest upgrade --check --diff --file <path>` and merge what you want by hand.
- `held`: the file is still efforge's, but its new version would break something of yours, so it stays as it is, with every file that needs it.

`doctor` gives each check one of `ok`, `warn`, `fail`, `skipped` or `unverified` (it could not read a file of yours the way it expects, which is not a failure).

## In CI

| Command | Exit code |
|---|---|
| `doctor` | `0` no check failed (warnings allowed), `2` a check failed |
| `upgrade --check` | `0` up to date or behind, `2` needs action |
| `upgrade --check --strict` | `0` up to date, `2` needs action, `3` behind |
| `upgrade` | `0` applied, `2` something still needs action that only you can fix |

Every command exits `1` on an error. A job that runs `upgrade --check` fails only when something breaks the project, not each time efforge ships a newer template; add `--strict` to fail when there is anything to apply. With `--json`, the same commands print one document each, with `ok: true` even when the exit code is `2` ([json.md](json.md)).

## A project from efforge 0.2.0

efforge 0.2.0 made projects without the Effect guard. When Effect 4.1 came out, a new install could put two Effect versions in one build, and `pnpm build` failed with `failed to resolve import "effect/..."`. Here is one such project brought forward: made with 0.2.0 (`--database=d1 --orm=effect-sql`, the default Better Auth with organizations), installed, with one change of its owner's, the dashboard's heading renamed, committed. The output below is from the efforge of this writing; its counts change with each release. (The project is efforge's own test fixture, `test/fixtures/v0.2.0`, and an end-to-end test checks that a real run still prints each line quoted here, counts and versions aside.)

`doctor` finds the problem (exit code `2`):

<!-- output: doctor -->
```text
✗ pnpm             packageManager pins pnpm 12.4.2, which ignores the overrides that keep Effect's packages on one version (they work from pnpm 12.17.0). upgrade raises it with the overrides.
                   Try: npx -y create-efforge upgrade
...
✗ effect           effect is 4.0.5, but @effect/platform-node-shared 4.1.4, @effect/sql-sqlite-do 4.1.4 resolved to another version: two Effects in one build, which fails (Effect's packages only work at one shared version). pnpm-workspace.yaml lacks the overrides that prevent it; upgrade writes them and installs.
                   Try: npx -y create-efforge upgrade
...
✗ gates            apps/web/src/server/routes.ts: requireApiSession is not in workerRoutes, so every route under /api/ answers a signed-out request. upgrade adds the gates, first in their lists.
                   Try: npx -y create-efforge upgrade
...
5 failed, 2 warnings, 8 ok, 1 skipped.
```

Besides the Effect guard, the `gates` check reports that the project has no session gates (0.2.0 had none): `requireApiSession`, which keeps routes under `/api/` behind a session, and `sessionGate`, which does the same for server functions. `upgrade` adds both.

`upgrade --check` says what `upgrade` would do (exit code `2`), and what the session gates it brings change for the project's server functions and routes:

<!-- output: upgrade --check -->
```text
Made with efforge 0.2.0; this is 0.2.1. Needs action: 2 things that break the project. Behind: 25 pins, 18 files to refresh, 35 new files, 3 files to give what the new ones need, 3 scripts, 2 to remove.
...
Needs action
  ✗ pnpm-workspace.yaml has no overrides holding Effect's packages at effect 4.0.5. A library that asks for a newer one then installs it next to the older effect and the build breaks, as 0.2.0 projects did when Effect 4.1 shipped. (upgrade fixes it)
  ✗ packageManager pins pnpm 12.4.2, which accepts the Effect overrides and silently ignores them (they work from pnpm 12.17.0). (upgrade fixes it)
```

`upgrade` applies it (exit code `0`). It added 35 files and refreshed the rest of efforge's, removed two efforge no longer generates, and gave the root `package.json` the `deploy` script and `wrangler`, so [the first deploy](deploy.md) works as it does for a new project. It kept the dashboard the owner changed, with the server files it imports and the ones those need:

<!-- output: upgrade -->
```text
Kept as they are
  yours    apps/web/src/routes/app/index.tsx
           You changed it, and efforge's template changed too: the dashboard shows one card per capability, a working demo beside the Effect code behind it.
  held     apps/web/src/server/auth-live.ts
           Kept as it is: apps/web/src/server/layers.ts imports `AuthLive` with the type it has now from it, and efforge's new version changes it.
  held     apps/web/src/server/auth.ts
           Kept as it is: apps/web/src/server/auth-live.ts imports `AuthInstance` as it is now, `makeAuth` as it is now from it, and efforge's new version changes it.
  held     apps/web/src/server/greeting.ts
           Kept as it is: apps/web/src/routes/app/index.tsx imports `getGreeting` from it, and efforge's new version changes it.
           Held with it, because they need it: apps/web/src/capabilities/runtime.tsx.
  held     apps/web/src/server/layers.ts
           Kept as it is: apps/web/src/server/runtime.ts imports `AppLayer` with the type it has now from it, and efforge's new version changes it.
  held     apps/web/src/server/notes.ts
           Kept as it is: apps/web/src/routes/app/index.tsx imports `listNotes` with the type it has now from it, and efforge's new version changes it.
           Held with it, because they need it: apps/web/src/capabilities/auth.tsx, apps/web/src/capabilities/database.tsx, apps/web/src/capabilities/registry.ts, +6 more.
  held     apps/web/src/server/runtime.ts
           Kept as it is: apps/web/src/server/greeting.ts imports `runtime` with the type it has now from it, and efforge's new version changes it.
```

A held server file still gets `requireSession` on its server functions, which the project's lint asks for. After the upgrade, `pnpm typecheck && pnpm check && pnpm test && pnpm build` passed, `pnpm run deploy --dry-run` built the Worker with its `DB` binding, `doctor` reported no failure, and `upgrade --check` said "Up to date: nothing to apply". To take the new dashboard, the owner merges `apps/web/src/routes/app/index.tsx` with efforge's version by hand, then runs `upgrade` again for the held files.

## Without the new CLI

If you can't run a newer efforge, repair a 0.2.0 project by hand. Any `efforge add` from 0.2.1 on does the same.

1. In the root `package.json`, set `"packageManager": "pnpm@12.21.0"`. pnpm 12.4.2 ignores the overrides below.
2. In `pnpm-workspace.yaml`, add these lines under `overrides:`, with your catalog's `effect` version (4.0.5 for 0.2.0):

   ```yaml
     effect@>=4.0.0-0: 4.0.5
     "@effect/ai-*": 4.0.5
     "@effect/atom-*": 4.0.5
     "@effect/openapi-generator": 4.0.5
     "@effect/opentelemetry": 4.0.5
     "@effect/platform-*": 4.0.5
     "@effect/sql-*": 4.0.5
     "@effect/vitest": 4.0.5
   ```

3. Run `pnpm install`, then the gate: `pnpm typecheck && pnpm check && pnpm test && pnpm build`.

When you upgrade `effect` yourself later, change the catalog entry and these overrides together ([why](decisions/0005-effect-lockstep-overrides.md)).

The design is in [ADR 0009](decisions/0009-upgrade-check-and-doctor.md) and [ADR 0011](decisions/0011-upgrade-applies-what-efforge-can-prove.md); [the CLI reference](cli.md#efforge-upgrade) has every flag.
