# 0003 — What efforge takes from rat-stack

Date: 2026-10-20. Status: accepted (maintainer).

## Context

[rat-stack](https://github.com/joelhooks/rat-stack) (MIT) is a GitHub template repo with nearly the same stack: Effect 4, Cloudflare Workers, Alchemy v2, Drizzle 1.0 RC, Better Auth, TypeScript 7 with `@effect/tsgo`, and oxlint. It is a working project you trim ("keep or cut"), not a generator, and it makes no support promise. Its main idea is a "fence": rules agents would otherwise only read in `AGENTS.md` are enforced by lint and types instead. We reviewed it at the commit of 2026-10-20.

## Decision

Adopted in the generated project:

- `lint/effect-tests.js`, a local oxlint JS plugin: `Effect.run*` and `ManagedRuntime.make` in `*.test.ts(x)` are errors; tests use `it.effect` and `it.layer`. Adapted from rat-stack's `scripts/oxlint-plugin-effect-tests.ts`. The `effect-ai-byok` crypto test was rewritten to comply.
- `no-restricted-imports` for `env` from `cloudflare:workers`, switched off for `apps/web/src/server/cloudflare.ts`. The "only cloudflare.ts reads env" rule was documentation; now lint enforces it.
- Two rules from Ultracite's oxlint preset (rat-stack lints with Ultracite): `typescript/no-deprecated` and `typescript/no-misused-promises`. On the generated house stack they found 6 uses of React's deprecated `FormEvent` (now `SubmitEvent`) and 14 async event handlers passed where React expects a void return (now `() => void handler()`). The rest of Ultracite was not adopted: on that stack its `core`, `react` and `anti-slop` presets reported 895 issues in 90 files, nearly all style, several against Effect idiom (`func-names` flags every `Effect.gen(function* () {})`), and its oxfmt preset would replace the Vite+ format settings from 0001.
- `AGENTS.md`: a Tests section (test layers rather than module mocks, check workerd behaviour under `pnpm dev` where a fake can differ) and "model lifecycles as tagged states, not boolean flags".

Not adopted, for now:

- XState v6 and `@xstate/effect`: both are alphas, and Effect plus Cloudflare Workflows and Durable Objects cover what generated apps need. Revisit as an opt-in add-on once they are stable.
- Cartridge layers that declare their own Alchemy resources (rat-stack's `D1` layer creates the database and provides the binding). It only fits `infra=alchemy` and would split how `efforge add` wires `infra=none` and Alchemy stacks.
- The Contract to CLI/HTTP/MCP/code-mode projections, Foldkit UI, varlock, and agent hook fences: outside efforge's scope.
- Generated agent skills (`skills/add-a-capability` and similar): worth doing, but it needs a decision on which agent directories to target.

## Consequences

- A generated project's `pnpm check` fails on manual runners in tests and stray `env` imports. Template tests must use `@effect/vitest`.
- `lint/effect-tests.js` is plain ESM with no dependency, so it works without `@oxlint/plugins`.
