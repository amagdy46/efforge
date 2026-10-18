# Contributing to efforge

Needs Node 24.11 or newer and pnpm 12.

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm test:e2e                        # every stack in the matrix; slow
pnpm test:e2e -t "stacks build minimal$"
node src/bin.ts my-app --dry-run     # run the CLI from source
node scripts/bump.ts [--write]       # pins vs npm latest
```

efforge lints and formats itself with Vite+ (`pnpm lint`, `pnpm format`, `pnpm check`). CI runs the unit checks, one e2e job per stack in `scripts/e2e-cases.ts`, a browser-image build and the browser flow against Postgres.

- All dependency versions are exact pins in `src/versions.ts`.
- Templates live in `templates/<slot>/<option>/`, each with an `addon.json`. `pnpm pack` drops some file names (nested `package-lock.json`, `.npmrc`), so store those under another name and map them with `target`; `test/addon.test.ts` checks every template file ships.
- Design decisions are recorded in `docs/decisions/`.
