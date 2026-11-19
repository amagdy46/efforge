# 0005 — Generated projects hold every Effect package at one version

Date: 2026-11-18. Status: accepted.

## Context

When Effect 4.1 shipped, every 0.2.0 stack with a database failed `pnpm build`
with `Rolldown failed to resolve import "effect/sql/MigratorFileSystem"`.
The catalog pinned `effect` and the `@effect/*` packages the project names to
4.0.5, but two packages arrived another way: `effect-cf` peers on
`@effect/sql-d1` and `@effect/sql-sqlite-do` (`^4.0.0`, not optional), and
`drizzle-orm` peers on every `@effect/sql-*` (`>=4.0.0`). pnpm auto-installed
those peers at 4.1.4, next to `effect` 4.0.5. `effect-cf` 0.59 also depends on
`@effect/platform-browser: ^4.1.0`. Effect's packages are released together
from one repository and only work at one shared version.

## Decision

The generated `pnpm-workspace.yaml` carries an override for every package
released with `effect`, all set to the `effect` pin:

```yaml
overrides:
  vite: "catalog:"
  effect@>=4.0.0-0: 4.1.4
  "@effect/ai-*": 4.1.4
  "@effect/atom-*": 4.1.4
  "@effect/openapi-generator": 4.1.4
  "@effect/opentelemetry": 4.1.4
  "@effect/platform-*": 4.1.4
  "@effect/sql-*": 4.1.4
  "@effect/vitest": 4.1.4
```

The list (`effectLockstep` in `src/versions.ts`) is the package families of
Effect-TS/effect-smol's `packages/` directory. `@effect/tsgo` and
`@effect/language-service` are versioned on their own and stay out of it;
a bare `@effect/*` would also catch `@effect/tsgo-linux-x64`, tsgo's binary,
which then silently fails to install (seen when probing).

The `effect` key is scoped to Effect 4 (`effect@>=4.0.0-0`). A bare `effect`
key rewrites every `effect` edge in the tree, including the private Effect 3
dependency of libraries such as `uploadthing` (`effect: 3.17.7`) and
`@prisma/config`, which then fail at import (`Cannot find module
.../effect/dist/Micro.js`). Scoped, those libraries keep their own copy and
every Effect 4 edge is still held at the pin.

`generate` writes the overrides. `add` writes any that are missing, at the
project's own catalog `effect` version, so running a new efforge on an older
project repairs it; an Effect package `add` introduces joins the catalog at that
version too, not at efforge's newest pin. Older pnpm ignores the wildcard keys
(see Evidence), so `add` also raises the root `packageManager` to the version
generated projects pin when it is older than 12.17.0, says so in its summary
and in `--json` (`packageManager: {from, to}`), and never lowers it. A project
made by 0.2.0 pins `pnpm@12.4.2`.

## Evidence (probed 2026-11-18, pnpm 12)

- Overrides apply to auto-installed peers: with explicit names
  (`"@effect/sql-sqlite-do": 4.0.5`) the 0.2.0 default stack installs 4.0.5.
- Wildcard keys (`"@effect/sql-*"`) take effect from pnpm 12.17.0. pnpm 12.4.2
  through 12.16.0 accept them and silently ignore them (bisected on the default
  stack). Generated projects therefore pin `packageManager: pnpm@12.21.0`, and
  pnpm switches to that version on its own.
- Regression case: the 0.2.0 pins (effect 4.0.5) plus these overrides, for
  the default stack and D1 + effect-sql + better-auth: no 4.1.x package
  installed, `pnpm peers check` clean, typecheck, check, test and build pass.
- Effect 3 dependents: on a guarded 0.2.0 project, `pnpm add -w uploadthing`
  with `effect: 4.0.5` gives uploadthing Effect 4.0.5 and
  `import("uploadthing/server")` fails; with `effect@>=4.0.0-0: 4.0.5` it gets
  3.17.7 and imports, the `@effect/sql-*` packages stay at 4.0.5, and the
  project still builds.
- Not chosen (from the pnpm docs, not probed): `peerDependencyRules` only
  changes which peer ranges pnpm accepts, and `autoInstallPeers: false` would
  leave `effect-cf`'s required peers unmet. Neither picks a version, and
  neither touches `@effect/platform-browser`, a plain dependency.

## Why this makes the failure impossible

The guard names release families, not today's packages, so a peer or
dependency that a library adds later (another sql driver, `platform-browser`)
is covered the day it appears. A regular override rewrites every matching
edge, including peers, so no range in anyone's manifest can pick another
version. Two checks keep it honest:

- `test/effect-lockstep.test.ts` checks the generated overrides cover every
  package effect-smol publishes and leave tsgo alone, and that `add` restores
  them on an older project.
- The e2e harness reads each stack's real `pnpm-lock.yaml` after install and
  fails if any lockstep package resolved to a version other than the catalog's
  `effect`, then runs `pnpm peers check`.

## Consequences

- Upgrading `effect` in a generated project means changing the catalog entry
  and the overrides together; the comment in `pnpm-workspace.yaml` says so.
- The family wildcards are not scoped by version. `@effect/ai-google`,
  `@effect/sql-drizzle` and `@effect/sql-kysely` have no 4.x release on npm
  (latest 0.16.0, 0.51.0 and 0.48.0), so the overrides would ask for a version
  that does not exist if a project added one (not probed). No efforge add-on
  uses them.
- A new family in effect-smol (a new `packages/` directory) needs a line in
  `effectLockstep`; the e2e lockfile check fails if one ever enters an
  install at another version.
