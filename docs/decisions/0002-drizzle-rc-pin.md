# 0002 — Drizzle stays the default ORM, pinned to a 1.0 release candidate

Date: 2026-10-18, updated 2026-11-18. Status: accepted (maintainer).

## Context

Drizzle 1.0 ships native Effect 4 drivers (`drizzle-orm/effect-postgres`, `effect-d1`). The official `1.0.0-rc.4` imports `Schema.TaggedErrorClass`, which `effect@4.0.5` does not export, so its Effect drivers throw at runtime. The hash-suffixed `1.0.0-rc.5-5935859` build (npm dist-tag `rc5`) uses `Schema.TaggedError` and works. All 16 e2e stacks pass with it.

## Decision

Keep `drizzle` as the default ORM, pinned exactly to `1.0.0-rc.5-5935859` for both `drizzle-orm` and `drizzle-kit`. `effect-sql` remains the alternative.

## Consequences

- We depend on an unofficial pre-release build. `scripts/bump.ts` flags it, and we move to the first official 1.0 release (rc or stable) that works with the Effect pin, verified by the full e2e suite.
- The README "Status and limits" section already states the pin.

## Update (2026-11-18): official `1.0.0-rc.5`

Drizzle published the official `1.0.0-rc.5` (npm dist-tag `rc`, 2026-10-21).
Its Effect drivers use `Schema.TaggedError`, which `effect@4.1.4` exports, and
it declares the same `>=4.0.0` peers on `effect` and `@effect/sql-*` as the
hash build. `drizzle-orm` and `drizzle-kit` now pin `1.0.0-rc.5`, together
with the move to Effect 4.1.4; the full e2e matrix passes with it (see the
wave-0 report). The npm `latest` tag is still the 0.x line, so `bump.ts` lists
the pin as "ahead"; move to 1.0.0 stable when it ships and the e2e suite
passes.

The open `>=4.0.0` peer ranges are what installed `@effect/sql-*` 4.1.4 next
to `effect` 4.0.5 in 0.2.0 projects; ADR 0005 is the guard.
