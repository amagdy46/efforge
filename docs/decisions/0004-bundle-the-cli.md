# 0004 — Ship the CLI as one bundled file with no runtime dependencies

Date: 2026-11-18. Status: accepted.

## Context

`create-efforge` 0.2.0 pinned its dependencies exactly (`effect: 4.0.5`,
`@effect/platform-node: 4.0.5`), and it still broke without a release: when
Effect 4.1 shipped, `@effect/platform-node@4.0.5`'s own range
`@effect/platform-node-shared: ^4.0.5` resolved to 4.1.4, which needs effect
4.1. `npx create-efforge` crashed with a missing export and `pnpm dlx` with a
missing module, before printing anything. Our lockfile hid it; npm and pnpm
ignore a dependency's lockfile.

Options considered:

- Pin the transitive package too. Fixes today's package, not the next range
  we don't control.
- `npm-shrinkwrap.json`. npm honours it, but `pnpm dlx` and `bun create`
  (both in the README) don't.
- `bundledDependencies`. Ships `node_modules` inside the tarball; works
  everywhere, but the tarball carries every file of every package
  (TypeScript twice: ts-morph's copy and its lib files).
- Bundle the code. Nothing is resolved on the user's machine.

## Decision

`pnpm build` runs `vp pack` (Vite+'s wrapper around tsdown), configured in
the `pack` block of `vite.config.ts`. It writes one ESM file, `dist/bin.js`,
with every dependency inlined. All of efforge's packages are
`devDependencies`; the published `package.json` has no `dependencies`,
`peerDependencies` or `optionalDependencies`. `templates/` ships as plain files
next to `dist/`.

Two settings were needed, found by running the bundle:

- `alias: { "jsonc-parser": "jsonc-parser/lib/esm/main.js" }`: the package's
  `main` is a UMD build that `require()`s its own files at runtime.
- `shims: true`: TypeScript (inside ts-morph) is CommonJS and reads
  `__filename`.

Code that finds files relative to the module walks up to the nearest
`package.json` named `create-efforge` (`src/versions.ts`), so it works from
`src/` and from `dist/bin.js` alike.

## Why this makes the failure impossible

The class of bug was "a range in someone else's manifest resolves to a
version we never tested". A package with no dependencies has no ranges to
resolve: npm, pnpm, bun and yarn all install the same bytes we tested.

`pnpm smoke:pack` checks it: it packs the tarball, asserts the manifest
declares no dependencies, installs it with npm into an empty directory with no
lockfile, and runs `--version`, `--help`, a `--dry-run` create, a real create
and an `add` (the ts-morph transforms) from there, then `npx --package` and
`pnpm dlx` on the tarball. `release.yml` runs it before `npm publish`.

## Consequences

- The tarball is 2.5 MB (13.4 MB unpacked, mostly TypeScript from ts-morph).
  0.2.0 installed more than that through its dependencies.
- `efforge --help` got faster: 400 ms median against 682 ms for 0.2.0's
  unbundled `dist/` (same machine, 11 runs each).
- Upgrading a dependency of the CLI is a normal devDependency bump; the
  lockfile decides what ships.
- Stack traces from the published CLI point into `dist/bin.js`, which is not
  minified, so they stay readable.
