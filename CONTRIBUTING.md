# Contributing to efforge

Needs Node 24.11+ or 26+ (not 25) and pnpm 12 (`packageManager` pins 12.21.0; pnpm switches to it).

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm format --check && pnpm test && pnpm build
pnpm smoke:pack                      # the packed tarball, installed with npm, runs
pnpm test:e2e                        # every stack in the matrix; slow
pnpm test:e2e -t "^stacks build > minimal$"  # one case; a filter that matches nothing skips all and exits 0
node src/bin.ts my-app --dry-run     # run the CLI from source
node scripts/bump.ts [--write]       # pins vs npm latest
node scripts/smoke-pack.ts           # pack, install like npm create, create + build + add
```

efforge lints and formats itself with Vite+ (`pnpm lint`, `pnpm format`, `pnpm check`). CI runs the unit checks, one e2e job per stack in `scripts/e2e-cases.ts`, a packed-tarball smoke test (`scripts/smoke-pack.ts`), a browser-image build and the browser flow against Postgres. It also runs daily and on demand, without the pnpm cache, so a dependency release that breaks new projects shows up within a day.

- Generated-project dependency versions are exact pins in `src/versions.ts`. `effectVersion` there covers `effect` and every package released with it; generated projects also hold those at that version through `overrides` ([ADR 0005](docs/decisions/0005-effect-lockstep-overrides.md)). `node scripts/bump.ts` lists pins behind npm and checks the lint toolchain against `@effect/tsgo`'s supported table and the vite-plus bundle; it exits 1 when they disagree.
- efforge's own packages are exact `devDependencies` in `package.json`; it has no runtime `dependencies`. `pnpm build` (`vp pack`, configured in `vite.config.ts`) bundles them into `dist/bin.js` ([ADR 0004](docs/decisions/0004-bundle-the-cli.md)). `pnpm smoke:pack` packs the tarball, installs it with npm in an empty directory and runs it; run it after changing a dependency or the build.
- Templates live in `templates/<slot>/<option>/`, each with an `addon.json`. `pnpm pack` drops some file names (nested `package-lock.json`, `.npmrc`), so store those under another name and map them with `target`; `test/addon.test.ts` checks every template file ships.
- Design decisions are recorded in `docs/decisions/`.

## Releasing

1. Move the `Unreleased` section of `CHANGELOG.md` under `## X.Y.Z (date)` and set `version` in `package.json` to `X.Y.Z`. Merge that to `main`.
2. Tag the merge and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

`.github/workflows/release.yml` then checks the tag matches `package.json`, runs typecheck, lint, tests and `pnpm smoke:pack`, publishes to npm through trusted publishing (OIDC, with provenance, no stored token), and creates the GitHub release from that CHANGELOG section. The npm side is configured under the package's Settings → Trusted Publisher: GitHub Actions, `amagdy46/efforge`, workflow `release.yml`.
