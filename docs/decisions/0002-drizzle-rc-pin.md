# 0002 — Drizzle stays the default ORM, pinned to 1.0.0-rc.5-5935859

Date: 2026-10-18. Status: accepted (maintainer).

## Context

Drizzle 1.0 ships native Effect 4 drivers (`drizzle-orm/effect-postgres`, `effect-d1`). The official `1.0.0-rc.4` imports `Schema.TaggedErrorClass`, which `effect@4.0.5` does not export, so its Effect drivers throw at runtime. The hash-suffixed `1.0.0-rc.5-5935859` build (npm dist-tag `rc5`) uses `Schema.TaggedError` and works. All 16 e2e stacks pass with it.

## Decision

Keep `drizzle` as the default ORM, pinned exactly to `1.0.0-rc.5-5935859` for both `drizzle-orm` and `drizzle-kit`. `effect-sql` remains the alternative.

## Consequences

- We depend on an unofficial pre-release build. `scripts/bump.ts` flags it, and we move to the first official 1.0 release (rc or stable) that works with the Effect pin, verified by the full e2e suite.
- The README "Status and limits" section already states the pin.
