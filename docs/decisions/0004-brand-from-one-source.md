# 0004 — Brand assets generated from one source file

Date: 2026-11-18. Status: accepted.

## Decision

efforge's identity (the punch-and-ef mark, the palette, the outlined wordmark) lives in
`scripts/brand/source.ts`. `pnpm brand` (`node scripts/brand/build.ts`) writes every asset from
it: the repo's SVGs and PNGs, the generated app's favicon, the "made with efforge" badge,
`src/brand.ts` for the terminal intro, and the palette table in `docs/brand.md`.
`test/brand.test.ts` fails when any of them is stale.

The PNGs are drawn by a small rasterizer and PNG encoder in `scripts/brand/raster.ts`, with no
dependencies. Text is vendored as outlined paths: the wordmark in `source.ts`, the other words
in `scripts/brand/text.ts`, which `pnpm brand:outline` writes from the fonts in the dev
dependencies (`opentype.js`, `@fontsource/saira-semi-condensed`, `@fontsource/jetbrains-mono`).

## Why

- Swapping the mark should be one commit: edit one file, run one command.
- A browser or librsvg would render differently across machines and is not in CI, so the
  staleness test could not regenerate PNGs. Our own renderer gives the same pixels everywhere.
- PNGs are compared by decoded pixels, not bytes, and `pnpm brand` only rewrites a PNG whose
  pixels changed, so a different zlib version cannot make the test flaky or churn the files.
- Outlined text means no asset depends on fonts installed on the viewer's machine, and
  `pnpm brand` needs neither the fonts nor the network.

## Cost

About 850 lines of build code for a handful of images, and three dev dependencies that only
`pnpm brand:outline` uses. The rasterizer supports only what the brand needs: solid fills,
the path commands M L H V Q C A Z, nonzero and even-odd rules.
