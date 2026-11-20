# 0008 — Add-ons contribute dashboard cards through a registry

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
- An add-on declares its card in `addon.json` (`card: { export, files, transforms? }`). `files[0]`
  is the card module under `apps/web/src/capabilities/`; the rest are files only the card uses, and
  its server functions live only in those files, under `apps/web/src/server/`. `card.transforms`
  may edit only the card's own files. This replaces the widgets list; there is one mechanism.
- A card's files, its transforms, a session guard efforge derives and the registration in
  `registry.ts` are one unit. `generate` and `add` apply all of it, or (in a project without the
  registry) none of it, with one note. Each transform applies only to card files the project has.
- On auth stacks every server function in a card's files gets `.middleware([requireSession])`.
  efforge adds it (an `addServerFnMiddleware` with `when: auth`), so a card author never writes it,
  and because it is an ordinary `when`, auth added after the card guards it too. A read is guarded
  like a write: a card shows the user's data.
- A card shows only the `// #region card` block of a file, cut out at build time by a small Vite
  plugin in the generated app (`apps/web/regions.ts`, `?region=card`). The rest of the file never
  reaches the browser, and a file without the region fails the build. The region is public; the
  contract and the generated `AGENTS.md` say so. A small lexer colours it at render time: no
  dependency, nothing extra in the Worker bundle, and both themes come from CSS tokens.
- Server functions behind cards use `runOutcome`, which returns tagged errors as data
  (`{ ok: false, error: { _tag, message } }`). A missing setting is handled once, where the runtime
  builds `AppLayer` (`server/settings.ts`): any add-on's `ConfigError` becomes `NotConfigured`,
  which names the setting and the file to put it in. A route shows it as a page (the router's
  default error component), a card as its "not configured" state. A serialization adapter
  (`start.ts`) keeps a tagged error's `_tag` on its way to the browser, which TanStack's own error
  serializer drops.
- An add-on file can be `ifAbsent`: written only where the project lacks it, never replaced. Auth
  brings the app shell and the project name to a 0.2.x project this way, without owning files the
  user is expected to edit.
- The landing page reads the stack from `efforge.jsonc` at build time, inside a server function so
  the file stays out of the client bundle. `add` already rewrites that file, so the page stays true
  without a new transform.
- The layer graph parses `AppLayer = Layer.mergeAll(...)` from the `card` region of `layers.ts`
  and annotates each layer from the card that names it, so it shows hand-added layers too.

## Consequences

- A project made before this (0.2.x), or one whose dashboard was removed, has no registry. `add`
  then writes the add-on without its card unit and reports it in `notes`; the card files are
  separate in the manifest because they import base files such a project does not have.
- The landing page's labels and file paths for each slot option live in `lib/stack.ts` in base. A
  new add-on (a new slot option) needs a row there as well as its card.
- Region lines are kept to 80 characters (the code column is laid out to hold 80 characters beside the demo from 1280 px); a repo test checks every
  region a registered card shows, on every stack.
- The generated lint config turns off `import/default` only for the files that import
  `?region=card` modules (TypeScript checks default imports, and the rule cannot see the default
  export of such a module), and allows `_tag` for `no-underscore-dangle`.
