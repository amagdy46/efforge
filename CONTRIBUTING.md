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
node scripts/cold-start.ts <project> --server=vite|alchemy|preview --scenario=all  # Better Auth on a cold Worker, 20 rounds
```

efforge lints and formats itself with Vite+ (`pnpm lint`, `pnpm format`, `pnpm check`). CI runs the unit checks, one e2e job per stack in `scripts/e2e-cases.ts`, a packed-tarball smoke test (`scripts/smoke-pack.ts`), a browser-image build and the browser flow against Postgres. It also runs daily and on demand, without the pnpm cache, so a dependency release that breaks new projects shows up within a day.

- Generated-project dependency versions are exact pins in `src/versions.ts`. `effectVersion` there covers `effect` and every package released with it; generated projects also hold those at that version through `overrides` ([ADR 0005](docs/decisions/0005-effect-lockstep-overrides.md)). `node scripts/bump.ts` lists pins behind npm and checks the lint toolchain against `@effect/tsgo`'s supported table and the vite-plus bundle; it exits 1 when they disagree.
- efforge's own packages are exact `devDependencies` in `package.json`; it has no runtime `dependencies`. `pnpm build` (`vp pack`, configured in `vite.config.ts`) bundles them into `dist/bin.js` ([ADR 0004](docs/decisions/0004-bundle-the-cli.md)). `pnpm smoke:pack` packs the tarball, installs it with npm in an empty directory and runs it; run it after changing a dependency or the build.
- Templates live in `templates/<slot>/<option>/`, each with an `addon.json`. `pnpm pack` drops some file names (nested `package-lock.json`, `.npmrc`), so store those under another name and map them with `target`; `test/addon.test.ts` checks every template file ships.
- `docs/addons/` is generated from the manifests: run `pnpm docs:addons` after changing an `addon.json` (its `guide` holds the page's prose). `pnpm docs:diagram` redraws the diagram in `docs/architecture.md` from the brand palette. Code samples in `docs/` carry a `<!-- sample: <path> -->` line and must match that file; a quoted message carries `<!-- quote: <path> -->`, and a block of project paths `<!-- paths -->`. `test/docs.test.ts` checks all of it, and `test/docs-add-commands.test.ts` runs every add-on page's "Add it" command.
- README pictures: `pnpm readme:screenshots` regenerates the dashboard picture (`.github/assets/dashboard-*.png`) from a new project, and `pnpm readme:demo` re-records `.github/assets/demo.gif` from `.github/assets/demo.tape` (needs vhs and ttyd; see the tape's header). Retake them after a visible change to the dashboard or the prompts.
- Design decisions are recorded in `docs/decisions/`.

## Releasing

On a branch from `next` (or wherever the release is), in order:

1. Move the `Unreleased` section of `CHANGELOG.md` under `## X.Y.Z (YYYY-MM-DD)`, written for someone on the last release: what they will notice, how to upgrade, then Added, Changed and Fixed against that release. Set `version` in `package.json` to `X.Y.Z`.
2. Run `node scripts/bump.ts`. Bump what is behind with `--write` and verify it as in step 5, or leave it and say why in the release notes of the pull request.
3. Run `node scripts/history.ts`. It records what this release generates (pins, scripts, the files efforge edits in place) in `src/history.data.ts`, formatted, which `upgrade` reads to tell efforge's lines from the user's. Check that the earlier releases' records are unchanged (`git diff src/history.data.ts` only adds), and empty the list of unreleased pins in the history test in `test/upgrade.test.ts`, which fails while this version is missing or a pin isn't recorded.
4. Regenerate what quotes the version: `EFFORGE_UPDATE_DOCS=1 pnpm vitest run test/json-docs.test.ts` (the examples in `docs/json.md`), the worked example in `docs/upgrading.md` (re-run it; `pnpm test:e2e -t "upgrading.md"` checks each quoted line), and `pnpm build && EFFORGE_BIN=$PWD/dist/bin.js pnpm readme:demo` (the demo shows the version on its first line; look at the frames). Search for the previous version (`git grep -n X.Y.Z-1`) and decide each hit.
5. Run the gate, then the unit suite as CI does, the packed tarball, and the whole e2e matrix: `pnpm typecheck && pnpm lint && pnpm format --check && pnpm test && pnpm build`, `CI=1 pnpm test`, `pnpm smoke:pack`, `pnpm test:e2e`.
6. Merge to `main`, then tag the merge and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

`.github/workflows/release.yml` then checks the tag matches `package.json`, runs typecheck, lint, the format check and tests, packs the tarball once, runs `pnpm smoke:pack --tarball` on it, publishes that same file to npm through trusted publishing (OIDC, with provenance, no stored token), and creates the GitHub release from that CHANGELOG section. The npm side is configured under the package's Settings → Trusted Publisher: GitHub Actions, `amagdy46/efforge`, workflow `release.yml`.

After the tag:

- The Release workflow passed (`gh run list --workflow release.yml`), and the GitHub release has the CHANGELOG section as its notes.
- npm has it: `npm view create-efforge version dist-tags` shows `X.Y.Z` as `latest`, with provenance on the package page.
- It runs as a user gets it: `npx -y create-efforge@X.Y.Z --version` prints `X.Y.Z`, and `npm create efforge@latest my-app -- --yes` creates a project that passes its gate.
- The schemas resolve: `https://unpkg.com/create-efforge@X.Y.Z/schemas/efforge.schema.json` (new projects' `$schema`) and `https://unpkg.com/create-efforge/schemas/efforge.schema.json` (every schema's `$id`, which follows `latest`).
