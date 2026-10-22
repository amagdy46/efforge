# Contributing to efforge

Needs Node 24.11+ or 26+ (not 25) and pnpm 12.

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm test:e2e                        # every stack in the matrix; slow
pnpm test:e2e -t "stacks build minimal$"
node src/bin.ts my-app --dry-run     # run the CLI from source
node scripts/bump.ts [--write]       # pins vs npm latest
```

efforge lints and formats itself with Vite+ (`pnpm lint`, `pnpm format`, `pnpm check`). CI runs the unit checks, one e2e job per stack in `scripts/e2e-cases.ts`, a browser-image build and the browser flow against Postgres.

- Generated-project dependency versions are exact pins in `src/versions.ts`; efforge's own dependencies are pinned in `package.json`.
- Templates live in `templates/<slot>/<option>/`, each with an `addon.json`. `pnpm pack` drops some file names (nested `package-lock.json`, `.npmrc`), so store those under another name and map them with `target`; `test/addon.test.ts` checks every template file ships.
- Design decisions are recorded in `docs/decisions/`.

## Releasing

1. Move the `Unreleased` section of `CHANGELOG.md` under `## X.Y.Z (date)` and set `version` in `package.json` to `X.Y.Z`. Merge that to `main`.
2. Tag the merge and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

`.github/workflows/release.yml` then checks the tag matches `package.json`, runs typecheck, lint and tests, publishes to npm through trusted publishing (OIDC, with provenance, no stored token), and creates the GitHub release from that CHANGELOG section. The npm side is configured under the package's Settings → Trusted Publisher: GitHub Actions, `amagdy46/efforge`, workflow `release.yml`.
