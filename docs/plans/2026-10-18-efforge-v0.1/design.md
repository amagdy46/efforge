---
type: design
status: approved
created: 2026-10-18
tags: [design, efforge]
---

# efforge v0.1

## Intent

`npm create efforge` scaffolds a full-stack TypeScript app on an opinionated Effect stack. In the author's words, it should be "opinionated for me but also customizable and can be used by others". Every part is replaceable, and more options can come later. The author uses it first for every new Ovriq product, starting with Spoorline. Releasing it publicly means others can use it, and it gives Ovriq visibility.

Why now: Spoorline is about to start M0 (auth, workspaces, DB, infra, deploy). That is exactly the boilerplate efforge generates, so building efforge *is* Spoorline's M0, done once and reusable.

## Success looks like

1. `npm create efforge spoorline -y --database=postgres --infra=alchemy --ai=effect-ai-byok --extras=workflows,realtime,browser,storage,email` produces a repo that installs, typechecks, lints, tests and builds with no edits.
2. `pnpm dev` on the result gives you sign-up, sign-in, create an organization, invite a member and switch organizations, against a local Postgres.
3. With `--infra=alchemy`, `pnpm deploy` puts it on Cloudflare, and every PR gets its own preview stage.
4. `efforge add email` on a project created without email adds it, leaving files the user has edited intact, or refuses with a clear message.
5. Spoorline's repo is regenerated from efforge, and its existing `decoders` and `cli` packages move over unchanged.
6. CI proves a curated set of stacks builds on every PR.

## Goals / non-goals / anti-goals

**Goals**
- Opinionated defaults, so `-y` gives the house stack.
- Each slot can be swapped at generation time, and add-ons can be added later with `efforge add`.
- Swapping works at runtime too. Generated app code depends on Effect **services** (`Database`, `Auth`, `Storage`, `Mailer`, `Jobs`, `Llm`), and each slot option provides a **Layer**. Changing an option means changing a layer, not rewriting app code.
- Generated code reads like hand-written code: no template syntax left behind and no unused branches.
- Every generated file typechecks and lints where it sits in the repo.

**Non-goals for v0.1**
- A Node runtime: the slot exists and is listed as "coming soon".
- Frameworks other than TanStack Start, and package managers other than pnpm.
- Third-party add-ons fetched from a URL: the manifest format allows them later.
- A web stack builder, an MCP server or agent plugin, and telemetry.
- Payments, docs sites, desktop or mobile apps.

**Anti-goals** (failure even if it works)
- Becoming a create-better-t-stack clone with dozens of shallow options. Each option must be one the author would really ship.
- Template files full of `{{#if}}` branches that nobody can maintain.
- An Effect-flavoured app where Effect is only a dependency and not how the code is structured.
- Silently overwriting a user's edits during `add`.

## Constraints

- Node 23.6 or newer for the CLI, since it runs TypeScript directly. Published builds go out as JS.
- Exact pinned versions, checked 2026-10-18:

  | Package | Version |
  |---|---|
  | drizzle-orm / drizzle-kit | 1.0.0-rc.4 (Effect 4 drivers) |
  | effect / @effect/* | 4.0.5 |
  | alchemy | 2.0.0-beta.83 |
  | better-auth | 1.7.10 |
  | @tanstack/react-start | 1.169.3 |
  | effect-cf | 0.56.7 |

- MIT license for efforge and its generated code, so users can build closed products. Spoorline stays AGPL in its own repo.
- No Neon default and no default infra tool. The defaults are "Postgres, any URL" and "no IaC".

## Decisions

- **Name `efforge`, public repo `amagdy46/efforge`.** (user, on my recommendation)
- **Every stack part is a replaceable slot. No Neon default, and infra is optional.** (user)
- **CLI built on `effect/cli` for commands and flags, with `@clack/prompts` for the interactive UI.** (user approved after the spike)
- **The generator is a pure function `(config) → VirtualTree`, written to disk at the end.** That gives us `--dry-run`, `--json`, safe `add` and testability, and keeps the door open for a browser preview. (my call; better-t-stack does the same)
- **Composition uses layered file overlays plus named, idempotent code transforms, with no Handlebars.**
  - Each option is a folder of real files, plus `addon.json`.
  - Shared "seam" files are edited by transforms using magicast or ts-morph:
    - `apps/web/src/server/layers.ts`, where layers are composed
    - the better-auth plugin list
    - `infra/alchemy.run.ts`
    - `vite.config.ts`
  - Overlays win in slot order. (my call; better-t-stack's Handlebars has 376 files under `auth` alone)
- **The add-on manifest is an Effect Schema shaped like a shadcn registry item.** Fields: `id`, `slot`, `title`, `description`, `docs`, `files[{path,target}]`, `dependencies`, `devDependencies` (names only, versions come from the catalog), `envVars`, `requires`, `conflicts`, `transforms[]`. (my call)
- **Compatibility is declared in a single rules table.** That table drives the prompts, `add`, flag validation and the CI test oracle. (my call)
- **The project manifest is `efforge.jsonc` at the repo root.** It records the efforge version, the choices, and a reproducible command, and `add` reads it. (my call)
- **Versions live in one `versions.ts` map,** emitted into the generated project as a pnpm `catalog:`. `scripts/bump.ts` updates it. (my call)
- **`add` touches only files listed by add-ons.** For each target file:
  - If it doesn't exist, write it.
  - If it exists with the content efforge originally generated, replace it.
  - If the user has changed it, refuse unless `--overwrite`, and show a diff first.
  - Transforms must be idempotent.
  - Hashes of generated files are stored in `efforge.jsonc`. (my call)
- **Generated repo layout:**

  ```
  apps/web/
    TanStack Start app
    auth pages
    org switcher
    settings shell
  packages/core/
    service interfaces
  packages/db/
    schema
    migrations
  infra/
    only when IaC is chosen
  ```

  Also pnpm + Turborepo, Biome and `@effect/vitest`. (my call)
- **The generated app ships a small real UI:**
  - auth screens
  - an organization switcher
  - members and invite settings
  - an empty dashboard
  - built with shadcn/ui and Tailwind v4, with dark and light themes

  (my call; Spoorline needs exactly this)
- **v0.1 options:**

  | Slot | Options |
  |---|---|
  | runtime | `cloudflare` |
  | database | `postgres` (any URL; Hyperdrive on Cloudflare), `d1`, `none` |
| orm | `drizzle`, `effect-sql` (when database≠none) |
  | auth | `better-auth-orgs`, `better-auth`, `none` |
  | infra | `none` (generates a `wrangler.jsonc`), `alchemy` |
  | ai | `none`, `effect-ai-byok` (an `Llm` service; keys encrypted per organization when auth has orgs) |
  | extras | `workflows`, `realtime`, `browser`, `storage`, `email` |

  Neon and Supabase become `database.provider` hints in v0.2. (my call)
- **CI tiers:** unit tests on the rules and generator, plus snapshot tests of generated trees. On every PR, one curated set of about 6 stacks is fully installed, typechecked and built. Live deploys stay out of CI. (my call)
- **Prompts support going back to the previous question**, grouped into sections, like better-t-stack's navigable group. Each prompt reads earlier answers to filter its options, and a flag skips its prompt. (user approved)
- **No telemetry in v0.1. If it's added later, it's opt-in.** (my call)

- **ORM is its own slot.** It is only asked when `database≠none`. (user asked for ORM options; options are my call)
  - **`drizzle` (default):** Drizzle 1.0 (`1.0.0-rc.4`, pinned) has native Effect 4 drivers (`drizzle-orm/effect-postgres`, `effect-d1`, `effect-schema`) built on `@effect/sql-pg` / `@effect/sql-d1`. Queries return Effects, migrations come from drizzle-kit, and better-auth has a first-party Drizzle adapter.
  - **`effect-sql`:** plain `@effect/sql` with tagged-template SQL and Effect Schema, plus SQL migrations run by the Effect migrator. Lightest, and the most "pure Effect".
  - **`prisma`:** v0.2. Prisma 7 runs on Workers through driver adapters, but it isn't Effect-native, so it would need a wrapper service.
  - **`kysely`:** not planned. `@effect/sql-kysely` still targets Effect 3.
  - Whichever ORM is chosen, it sits behind the same `Database` service, so app code doesn't change.
- **The better-auth schema** is generated with the better-auth CLI. With Drizzle it becomes Drizzle schema files and migrations. With `effect-sql` it is committed as a SQL migration. Either way `packages/db` owns those tables. (my call)
- **Invites:** without the `email` extra, an invite produces a copyable link. With it, the link is also sent by email. (my call)
- **What each extra provides:**

  | Extra | Generates |
  |---|---|
  | `workflows` | A `Jobs` service plus an example Workflow |
  | `realtime` | A `Realtime` service backed by a Durable Object with hibernating WebSockets, plus a `useRoom` hook |
  | `browser` | A `Browser` service with `apps/browser`: a Dockerfile with Playwright and Chromium, run as a Cloudflare Container. CI builds the image, but only for stacks that include `browser`, and never pushes it. |
  | `storage` | A `Storage` service on R2 |
  | `email` | A `Mailer` service on Cloudflare Email |

  (my call)
- **Compatibility rules for v0.1:**
  - `auth≠none` requires `database≠none`.
  - `workflows`, `realtime`, `browser` and `d1` require `runtime=cloudflare`.
  - With `infra=none`, every binding goes into `wrangler.jsonc`. With `infra=alchemy`, they go into `infra/alchemy.run.ts`, and no `wrangler.jsonc` is generated.
  - All other combinations are valid. (my call)
- **Seam files vs overlays during `add`:**
  - The hash check applies only to overlay files.
  - Seam files are always edited through transforms, even after the user has changed them.
  - A transform finds its anchor (an import list, the `Layer.mergeAll(...)` call, the plugin array). If the anchor is missing, `add` stops, names the file, and prints the snippet to paste by hand. (my call)
- **Cloudflare bindings in the generated app** come from `effect-cf`, which provides them as layers. App code never reads `env` directly. (my call)
- **Alchemy previews:**
  - Picking alchemy also generates `.github/workflows/deploy.yml`. It deploys `prod` on main and `pr-<n>` on each PR, and destroys the PR stage on close.
  - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ALCHEMY_PASSWORD` and `DATABASE_URL`. With "Postgres, any URL", every PR preview shares one preview database; per-PR database branches arrive with the Neon provider in v0.2.
  - Live deploys are verified by hand, not in CI. (my call)
- **Versions:** `@effect/sql-pg`, `@effect/sql-d1`, `@effect/vitest` and `@effect/ai-anthropic`/`-openai`/`-openrouter` are all at 4.0.5, and Effect 4's AI core lives in `effect` itself. `@effect/ai` 0.37 is the old v3 package; don't use it. Tooling: magicast 0.5.5, ts-morph 28.0.0.
- **Spoorline integration:**
  - `packages/decoders` and `apps/cli` are plain TypeScript with no Effect, so they work alongside the generated code as they are.
  - The only integration point is the `packages/*` / `apps/*` workspace globs.
  - Spoorline is regenerated on a branch of its existing repo, so its history is kept. (my call)

## Left to the builder

- The internal module layout of efforge itself.
- Whether transforms use magicast or ts-morph in each case.
- Snapshot format, the curated CI stacks, and how a diff is shown on conflicts.
- Exact env var names, and the wording of prompts and help.

## Open questions

- None blocking. Spoorline-specific packages (`decoders`, `capture`, `rules`, `fixtures`) stay in Spoorline and are not efforge add-ons.

## As built

Where v0.1 differs from the design above:

- **Vite+ and Oxlint instead of Biome.** Lint and format run through Vite+ (`vp lint`, `vp fmt`, `vp check`), configured in each project's root `vite.config.ts`, with Effect diagnostics from `@effect/tsgo`. See `docs/decisions/0001-vite-plus.md`. The templates and everything transforms insert are already formatted with that config, so a project passes `pnpm check` straight after `create --no-install`; a unit test runs the formatter in check mode over `templates/` and over generated stacks.
- **Drizzle is pinned to `1.0.0-rc.5-5935859`.** `drizzle-orm` and `drizzle-kit` use the Effect-based 1.0 drivers, and `1.0.0-rc.4` calls `Schema.TaggedErrorClass`, which Effect 4.0.5 does not export, so its drivers fail at import time. rc.5 fixes that. It is a release candidate, so it is an exact pin and `scripts/bump.ts` reports newer versions.
- **`routeTree.gen.ts` is generated after install.** TanStack Router writes it with `tsr generate`; it is not in the templates. `create` and `add` run it after `pnpm install`, and the `postinstall`/`typecheck` scripts regenerate it.
- **`add` is general.** Each transform declares the files it touches (`transformTargets`), overlays and transforms switched on by the new choice also apply to add-ons already in the stack (for example `infra=alchemy` wires their secrets), and `infra/alchemy` removes the generated `wrangler.jsonc`.
- **Root package name** is `<name>-monorepo`, so it never clashes with a workspace package named `<name>`.

## Next

After approval: write `plan.md` (writing-plans skill), build efforge v0.1, generate Spoorline from it, and move the existing Spoorline packages over.

## Prior art

| Project | What we take or avoid |
|---|---|
| create-better-t-stack | VFS generator, `bts.jsonc`, `add` with dry-run, compatibility oracle, tiered CI, version map. We avoid its Handlebars sprawl. |
| shadcn registry | Item JSON shape, `add --dry-run/--diff`, items treated as data |
| create-t3-app | Installer map and CI matrix script. We avoid its per-combination files. |
| Astro `add` | magicast edits to existing config |
