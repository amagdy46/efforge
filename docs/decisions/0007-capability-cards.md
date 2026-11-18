# 0007 — Add-ons contribute dashboard cards through a registry

Date: 2026-11-18. Status: accepted.

## Context

The generated app's dashboard showed a greeting, a notes list when there was a database, and the
realtime demo, which reached the page through `components/widgets.tsx` and an `addArrayItem`
transform. Every ORM and auth add-on replaced the dashboard page to add its own section, so each
replacement had to remember to render the widgets, and storage, email, workflows, AI and browser had
nothing on the page at all. Wave 2 makes the dashboard the proof of efforge's promise: each
capability working, next to the Effect code behind it, and adding an add-on adds its card.

## Decision

- One dashboard page (`routes/app/index.tsx`, in base) renders `capabilities` from
  `apps/web/src/capabilities/registry.ts`. Add-ons no longer replace the page.
- An add-on declares its card in `addon.json` (`card: { export, files }`). `files[0]` is the card
  module under `apps/web/src/capabilities/`; the rest are files only the card uses. `generate` and
  `add` write them and register the export with the existing `addArrayItem` transform. This replaces
  the widgets list; there is one mechanism.
- A card's code is the real source, imported with Vite's `?raw` and cut by `// #region card`
  markers, so it follows the user's edits. A small lexer colours it at render time: no
  dependency, nothing extra in the Worker bundle, and both themes come from CSS tokens.
- Server functions behind cards use `runOutcome`, which returns tagged errors as data
  (`{ ok: false, error: { _tag, message } }`) and a missing setting as `NotConfigured`, so a demo
  shows failure as a state instead of an error page.
- The landing page reads the stack from `efforge.jsonc` at build time, inside a server function so
  the file stays out of the client bundle. `add` already rewrites that file, so the page stays true
  without a new transform.
- The layer graph parses `AppLayer = Layer.mergeAll(...)` from `layers.ts` (also `?raw`) and
  annotates each layer from the card that names it, so it shows hand-added layers too.

## Consequences

- A project made before this (0.2.x) has no registry. `add` then writes the add-on without its
  card files, skips the registration and prints one line; the card files are separate in the
  manifest because they import base files such a project does not have.
- The landing page's labels and file paths for each slot option live in `lib/stack.ts` in base. A
  new add-on (a new slot option) needs a row there as well as its card.
- The generated lint config turns off `import/default` (TypeScript checks default imports, and the
  rule cannot see the default export of a `?raw` module) and allows `_tag` for
  `no-underscore-dangle`.
