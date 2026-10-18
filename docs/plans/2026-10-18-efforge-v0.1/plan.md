---
type: plan
status: draft
design: ./design.md
---

# efforge v0.1 Plan

**Goal:** `npm create efforge` generates a working Effect 4 + TanStack Start + Cloudflare app from replaceable slots, `efforge add` extends it safely, and Spoorline is regenerated from it.

**Approach:** First a pure core: a slot registry with compatibility rules, an add-on manifest, an in-memory tree generator and idempotent transforms. Then the templates, one slot at a time, each proven by generating and building a real project. Last come the CLI, `add`, CI and Spoorline. The trade-off is that template work is slow to verify (install + build per stack), so unit tests cover the core and a separate e2e suite builds 8 curated stacks.

## Global constraints

- Node ≥ 23.6 runs `.ts` directly. Source is TS (`"type": "module"`, NodeNext, strict, `verbatimModuleSyntax`), and published output is built with `tsc` to `dist/`.
- Exact pins, kept in `src/versions.ts` only:

  | Package | Version |
  |---|---|
  | `effect`, `@effect/platform-node`, `@effect/sql-pg`, `@effect/sql-d1`, `@effect/vitest`, `@effect/ai-anthropic`, `@effect/ai-openai`, `@effect/ai-openrouter` | `4.0.5` |
  | `alchemy` | `2.0.0-beta.83` |
  | `better-auth` | `1.7.10` |
  | `@tanstack/react-start` | `1.169.3` |
  | `effect-cf` | `0.56.7` |
  | `drizzle-orm`, `drizzle-kit` | `1.0.0-rc.4` |
  | `@clack/prompts` | `1.8.1` |
  | `magicast` | `0.5.5` |
  | `ts-morph` | `28.0.0` |

  Check other packages with `npm view <pkg> dist-tags.latest` when you add them, and pin those versions exactly.
- Don't use `@effect/ai` 0.37 (it's Effect 3); Effect 4's AI core is `effect/ai`. Don't use `@effect/sql-kysely` (Effect 3).
- No Handlebars and no template syntax in template files. Every template file must be valid TS/JSON in place.
- The generated project uses pnpm only, with Turborepo, Biome, `@effect/vitest`, Tailwind v4 + shadcn/ui, and a `catalog:` in `pnpm-workspace.yaml` filled from `src/versions.ts`.
- App code in generated projects reads Cloudflare bindings only through `effect-cf` layers, never `env` directly.
- Slots and v0.1 options:

  | Slot | Options | Default |
  |---|---|---|
  | `runtime` | `cloudflare` | `cloudflare` |
  | `database` | `postgres`, `d1`, `none` | `postgres` |
  | `orm` | `drizzle`, `effect-sql`, `none` | `drizzle` |
  | `auth` | `better-auth-orgs`, `better-auth`, `none` | `better-auth-orgs` |
  | `infra` | `none`, `alchemy` | `none` |
  | `ai` | `none`, `effect-ai-byok` | `none` |
  | `extras` (multi) | `workflows`, `realtime`, `browser`, `storage`, `email` | `[]` |

- Compatibility rules:
  - `orm≠none` ⇔ `database≠none`.
  - `auth≠none` ⇒ `database≠none`.
  - `d1`, `workflows`, `realtime` and `browser` ⇒ `runtime=cloudflare`.
  - `infra=none` ⇒ `wrangler.jsonc` holds every binding.
  - `infra=alchemy` ⇒ `infra/alchemy.run.ts` holds them, and no `wrangler.jsonc` is generated.
- License: MIT for efforge and its templates.
- Commits: plain `git commit`, never setting the author. Small commits, one per task minimum.

## Review focus

1. `efforge add` on a project whose seam file (`layers.ts`) the user edited: the transform must still apply, or stop with the paste snippet (Task 12).
2. Running the same transform or `add` twice gives an identical tree, so transforms are idempotent (Tasks 5 and 12).
3. A flag that contradicts an earlier answer or rule (`--database=none --auth=better-auth`) fails with a message listing valid options, both with `-y` and interactively (Tasks 2 and 11).
4. A user-edited overlay file during `add`: refuse without `--overwrite`, and show a diff (Task 12).
5. Invalid project names (`My App`, `../x`) are rejected before anything is written (Task 2).
6. Generated stacks drift from pins: the e2e suite builds all 8 curated stacks (Task 13).

## Tasks

### Task 1: Tooling and repo layout

**Files:**
- Modify `package.json`:
  - name `efforge`, `"license": "MIT"`, `"bin": { "efforge": "dist/bin.js", "create-efforge": "dist/bin.js" }`, `"files": ["dist", "templates"]`
  - scripts `typecheck`, `test` (vitest), `test:e2e` (vitest `-c vitest.e2e.config.ts`), `build` (tsc), `lint` (biome)
- Create `tsconfig.json`, `biome.json`, `vitest.config.ts` (excludes `test/e2e`), `vitest.e2e.config.ts` (with a 15-minute timeout), `LICENSE` (MIT, holder "Abdulrahman Magdy"), and `.github/workflows/ci.yml` (typecheck, lint, test on PRs and main).
- Move `src/main.ts` to `spike/main.ts`; it stays runnable as a reference and is deleted in Task 11.

**Interfaces:** produces the scripts above.
**Blocked by:** none

- [x] Write the test `test/smoke.test.ts`: `it.effect("runs", () => Effect.succeed(1).pipe(Effect.map(n => expect(n).toBe(1))))` using `@effect/vitest`
- [x] Run `pnpm test`; expect pass. Run `pnpm typecheck` and `pnpm lint`; expect both clean
- [x] Commit

### Task 2: Stack config, slot registry, compatibility rules

**Files:**
- Create `src/stack.ts`, `src/slots.ts` and `src/rules.ts`.
- Test `test/rules.test.ts`.

**Interfaces:** produces:
- `StackConfig`: an Effect Schema struct with
  - `name`
  - `runtime`, `database`, `orm`, `auth`, `infra`, `ai`, each a `Schema.Literals`
  - `extras: Schema.Array(Extra)`
- `ProjectName`: a Schema matching the npm name pattern `^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$` and containing no `..`.
- `SlotId`.
- `OptionDef { id; label; hint?; slot: SlotId }`, and `slots: ReadonlyArray<{ id: SlotId; title: string; section: "Platform" | "Data" | "Features"; multi: boolean; default: string | string[]; options: OptionDef[] }>`, in order runtime, database, orm, auth, infra, ai, extras.
- `available(slot: SlotId, partial: Partial<StackConfig>): ReadonlyArray<OptionDef>`.
- `withDefaults(partial: Partial<StackConfig> & { name: string }): StackConfig`. It picks each slot's default if available, else that slot's first available option.
- `validate(config: StackConfig): Effect<StackConfig, IncompatibleStack>`, where `IncompatibleStack` is a `Schema.TaggedError` with `{ slot, value, allowed: string[] }`.
- `toCommand(config): string`, which returns `npm create efforge <name> -- --database=… …` and omits values equal to defaults.

**Blocked by:** 1

- [x] Write failing tests:
  - `available("orm", {database:"none"})` returns only `none`.
  - `available("auth", {database:"none"})` returns only `none`.
  - `withDefaults({name:"a"})` equals the default row of the slot table.
  - `withDefaults({name:"a", database:"none"})` has `orm:"none", auth:"none"`.
  - `validate` with `auth:"better-auth", database:"none"` fails with `IncompatibleStack{slot:"auth"}`.
  - `Schema.decodeUnknownEither(ProjectName)("My App")` is a Left, and so is `"../x"`.
  - `toCommand(withDefaults({name:"a"}))` equals `"npm create efforge a"`.
- [x] Run `pnpm test rules`; expect failures
- [x] Implement; run; expect pass
- [x] Commit

### Task 3: Add-on manifest and loader

**Files:**
- Create `src/addon.ts` and `templates/base/addon.json`.
- Test `test/addon.test.ts`.

**Interfaces:** produces:
- The `AddonManifest` Schema:
  - `id` (`"<slot>/<option>"`, or `"base"`), `title`, `description`, `docs?`
  - `files: { path: string; target: string; when?: Partial<Record<SlotId, string[]>> }[]`, where `path` is relative to the add-on dir and `target` is relative to the project root
  - `dependencies: Record<string, string[]>`, mapping a workspace package dir such as `"apps/web"` to package names, with versions resolved from `versions.ts`
  - `devDependencies` with the same shape
  - `envVars: { name; example; description }[]`
  - `requires: string[]`, `conflicts: string[]`
  - `transforms: { name: string; args: Record<string, string>; when? }[]`
- `loadAddons(templatesDir: string): Effect<ReadonlyMap<string, LoadedAddon>, AddonLoadError, FileSystem>`, where `LoadedAddon = { manifest; dir: string }`.
- `addonIdsFor(config: StackConfig): string[]`:
  - It returns `base`, then one id per slot whose value isn't `none`, then the extras, in slot order.
  - Example: `["base","runtime/cloudflare","database/postgres","orm/drizzle",…]`.

Templates live in `templates/<slot>/<option>/`, plus `templates/base/`.
**Blocked by:** 2

- [x] Write failing tests:
  - Loading `templates/` decodes every `addon.json`.
  - Every `requires`/`conflicts` id exists in the map.
  - Every `files[].path` exists on disk.
  - Every non-`none` option in `slots` has a folder. Mark this one `it.todo` until Task 10, and turn it on there.
  - `addonIdsFor(withDefaults({name:"a"}))` equals the expected array.
- [x] Implement; run `pnpm test addon`; expect pass
- [x] Commit

### Task 4: Virtual tree and generator core

**Files:**
- Create `src/tree.ts`, `src/versions.ts`, `src/generate.ts` and `src/manifest.ts`.
- Test `test/generate.test.ts`, with a fixture templates dir at `test/fixtures/templates/`.

**Interfaces:** consumes `StackConfig`, `loadAddons` and `addonIdsFor`. Produces:
- `type Tree = ReadonlyMap<string, string>`
- `versions: Record<string, string>`
- `generate(config, addons): Effect<Tree, GenerateError | TransformAnchorMissing>`, which:
  - applies the add-ons in `addonIdsFor` order
  - copies files whose `when` matches; later files win on the same target
  - merges `dependencies` into each target `package.json` as `"catalog:"`, and writes the `catalog` section of `pnpm-workspace.yaml` from `versions` (only the packages used)
  - appends `envVars` to `.env.example`, deduplicated by name and grouped under a comment with the add-on title
  - runs `transforms` through `runTransform` from Task 5; until then, use a stub that returns the tree unchanged
  - writes `efforge.jsonc` last
- `EfforgeManifest` Schema `{ efforgeVersion: string; stack: StackConfig; command: string; files: Record<string, string> }`, where `files` maps each overlay target to `hash(content)` (sha256 hex, the first 16 characters).
- `hash(content: string): string`

**Blocked by:** 3

- [x] Write failing tests against the fixtures:
  - Overlay order: a later add-on's file replaces the earlier one.
  - A `when` mismatch skips the file.
  - Deps from two add-ons merge into `apps/web/package.json` as `catalog:`.
  - The catalog only lists used packages, at pinned versions.
  - `.env.example` is deduplicated.
  - `efforge.jsonc` round-trips through `EfforgeManifest`, and `files` hashes match.
  - A missing `versions` entry fails with `GenerateError{reason:"unpinned", package}`.
- [x] Implement; run `pnpm test generate`; expect pass
- [x] Commit

### Task 5: Transforms

**Files:**
- Create `src/transforms/index.ts`, `addLayer.ts`, `addAuthPlugin.ts`, `addAlchemyResource.ts`, `addWranglerBinding.ts` and `addImport.ts` in `src/transforms/`.
- Test `test/transforms.test.ts`.

**Interfaces:**
- `type Transform = (tree: Tree, args: Record<string,string>) => Effect<Tree, TransformAnchorMissing>`.
- `TransformAnchorMissing` is a TaggedError `{ file, anchor, snippet }`.
- `runTransform(tree, {name,args}): Effect<Tree, TransformAnchorMissing | UnknownTransform>`.

Anchors:

| Transform | Args | Edits |
|---|---|---|
| `addLayer` | `{file, import, from, layer}` | Adds the import and appends `layer` to the `Layer.mergeAll(...)` call exported as `AppLayer` (ts-morph) |
| `addAuthPlugin` | `{import, from, call}` | Appends `call` to the `plugins: [...]` array in `apps/web/src/server/auth.ts` (ts-morph) |
| `addAlchemyResource` | `{name, code}` | Inserts `code` before the `// efforge:resources` marker comment in `infra/alchemy.run.ts`, and adds `name` to the bindings object passed to the Worker (ts-morph) |
| `addWranglerBinding` | `{key, value}` | `value` is JSON. Merges it into the `wrangler.jsonc` top-level `key` array (jsonc-parser), deduplicated by `binding` or `name` |
| `addImport` | `{file, import, from}` | Adds the import only |

Each transform is a no-op when its edit is already present.
**Blocked by:** 4

- [x] Write failing tests for each transform:
  - Applied once, it produces the expected output.
  - Applied twice, the result is identical to applying it once.
  - With the anchor missing, it fails with `TransformAnchorMissing` containing the snippet.
  - `addLayer` on a file where the user has added their own layer and reformatted the code still appends correctly.
- [x] Implement; wire it into `generate`; run `pnpm test`; expect pass
- [x] Commit

### Task 6: Base template, the "minimal" stack builds

**Files:** `templates/base/**` and `templates/runtime/cloudflare/**`.
- **Root files:** `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `biome.json`, `tsconfig.base.json`, `.gitignore`, `README.md`.
- **`apps/web`:**
  - TanStack Start with `@cloudflare/vite-plugin`
  - Tailwind v4 + shadcn/ui (`button`, `card`, `input`, `label`, `dropdown-menu`, `dialog`, `avatar`, `sonner`), with a dark/light theme toggle
  - routes `/` (landing) and `/app` (empty dashboard shell with a sidebar)
- **`apps/web/src/server/`:**
  - `layers.ts`, exporting `AppLayer = Layer.mergeAll(/* efforge:layers */)`
  - `runtime.ts`, a `ManagedRuntime` used by server functions
- **`packages/core/src/index.ts`:** an empty services barrel.
- **`wrangler.jsonc`:** comes from `runtime/cloudflare`, and every overlay that writes it carries `when: {infra:["none"]}`.
- Test `test/e2e/stacks.test.ts`, with the helper `buildStack(config): Effect<void>`:
  - generate into a tmp dir
  - `pnpm install`
  - `pnpm typecheck && pnpm lint && pnpm build`
  - assert the exit code is 0

**Interfaces:** produces the seam files with the anchors Task 5 expects (`AppLayer` / `Layer.mergeAll`).
**Blocked by:** 5

- [x] Add the e2e case `minimal` (`database=none, auth=none, infra=none, ai=none, extras=[]`)
- [x] Run `pnpm test:e2e -t minimal`; expect fail
- [x] Build the templates; run; expect pass. Also run `pnpm dev` in a generated copy and check that `/` and `/app` render (screenshot or curl HTML)
- [x] Commit

### Task 7: Database and ORM add-ons

**Files:** `templates/database/{postgres,d1}/**` and `templates/orm/{drizzle,effect-sql}/**`, producing `packages/db`.
- **Service:** `packages/core/src/Database.ts` defines `class Database extends Context.Service<…>` (Effect 4 service syntax), with `sql` for effect-sql or `db` for drizzle.
- **Layers:** `packages/db/src/layer.ts`:

  | ORM | Uses |
  |---|---|
  | drizzle | `drizzle-orm/effect-postgres` or `drizzle-orm/effect-d1`, selected by `when` |
  | effect-sql | `@effect/sql-pg` or `@effect/sql-d1` |

- **Postgres connection:** goes through Hyperdrive. Wrangler gets a `hyperdrive` binding with `localConnectionString` set to `DATABASE_URL`.
- **D1:** gets a `d1_databases` binding.
- **Migrations:**

  | ORM | Tooling |
  |---|---|
  | drizzle | `drizzle.config.ts` + drizzle-kit |
  | effect-sql | `packages/db/migrations/0001_init.sql` + an Effect migrator script |

  Either way the script is `pnpm db:migrate`.
- **Local Postgres:** a `docker-compose.yml` with Postgres 17, under `when: {database:["postgres"]}`.
- **Example table:** `note(id, org_id nullable, title, created_at)`, plus one server function listing notes on `/app`.

**Blocked by:** 6

- [x] Add e2e cases `pg-drizzle` and `d1-effect-sql` (`auth=none`); run; expect fail
- [x] Implement; run; expect pass. For `pg-drizzle`, also run `docker compose up -d`, `pnpm db:migrate` and `pnpm dev`, and check `/app` lists notes
- [x] Commit

### Task 8: Auth add-ons with organizations UI

**Files:** `templates/auth/{better-auth,better-auth-orgs}/**`.

- **Server:** `apps/web/src/server/auth.ts` has `betterAuth({ database: <drizzle adapter | pg/d1 dialect>, plugins: [/* efforge:auth-plugins */] })`. The `-orgs` variant runs `addAuthPlugin` with `organization()`.
- **Service:** `packages/core/src/Auth.ts` defines an `Auth` service with `currentSession: Effect<Session, Unauthorized>`.
- **Routes:** `/sign-in`, `/sign-up`, and a `/app` guard. The orgs variant adds:
  - an org switcher in the sidebar
  - `/app/settings/members`: list members, invite by email, show a copyable invite link, change role, remove
  - `/accept-invite/$id`
  - create-org on first sign-in
- **Schema:** generated with `npx @better-auth/cli generate` and committed into the template (`packages/db/src/auth-schema.ts` for drizzle, `packages/db/migrations/0000_auth.sql` for effect-sql).
- **Env:** `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`.

**Blocked by:** 7

- [x] Add e2e cases `pg-drizzle-orgs`, `pg-effect-sql-orgs` and `d1-drizzle-auth`; run; expect fail
- [x] Implement; run; expect pass
- [x] Add a Playwright check inside the e2e helper, gated by the env `EFFORGE_E2E_BROWSER=1`, against `pg-drizzle-orgs` running on `pnpm dev`. It must: sign up, create an org, invite (link shown), sign up a second user via the link, and see both members
- [x] Commit

### Task 9: Infra (alchemy vs wrangler)

**Files:** `templates/infra/alchemy/**`:
- `infra/alchemy.run.ts` with stages via `process.env.STAGE`, `Cloudflare.Website.Vite("web", …)` and the `// efforge:resources` marker
- `.github/workflows/deploy.yml`:
  - deploys `prod` on push to main and `pr-${{ github.event.number }}` on PRs
  - destroys the PR stage on close
  - uses the secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ALCHEMY_PASSWORD` and `DATABASE_URL`
- root scripts `deploy` and `destroy`

Database add-ons also declare `when: {infra:["alchemy"]}` transforms (`addAlchemyResource`) for Hyperdrive and D1.
**Blocked by:** 8

- [x] Write a failing unit test in `test/generate.test.ts`:
  - With `infra=alchemy`, there is no `wrangler.jsonc`, `alchemy.run.ts` contains a `Hyperdrive` resource, and `deploy.yml` exists.
  - With `infra=none`, `wrangler.jsonc` has a `hyperdrive` binding.
- [x] Add e2e case `pg-drizzle-orgs-alchemy`; implement; run both; expect pass (typecheck and build only, no deploy)
- [x] Commit

### Task 10: AI and extras add-ons

**Files:**
- **`templates/ai/effect-ai-byok`:**
  - an `Llm` service in core
  - a provider layer factory `makeLlmLayer({provider: "anthropic"|"openai"|"openrouter"|"ollama", apiKey, model})`, using the `@effect/ai-*` packages; Ollama goes through `@effect/ai-openai` with a `baseUrl`
  - when auth has orgs: an `llm_credential` table with the key encrypted (AES-GCM via WebCrypto, key from `LLM_ENCRYPTION_KEY`), plus `/app/settings/ai`
- **`templates/extras/workflows`:**
  - a `Jobs` service
  - `apps/web/src/workflows/Example.ts`, a Cloudflare Workflow via effect-cf
- **`templates/extras/realtime`:**
  - a `Realtime` service
  - a `Room` Durable Object with hibernating WebSockets
  - a `useRoom(roomId)` React hook
- **`templates/extras/storage`:** a `Storage` service on R2, with `put`/`get`/`signedUrl`.
- **`templates/extras/email`:**
  - a `Mailer` service on Cloudflare Email
  - when auth has orgs, it also sends invite emails, using `addAuthPlugin` args on `organization({ sendInvitationEmail })` (extend `addAuthPlugin` with an option `mergeInto: "organization"`)
- **`templates/extras/browser`:**
  - a `Browser` service
  - `apps/browser/Dockerfile` (`mcr.microsoft.com/playwright` base) plus a small Effect HTTP server with `POST /run`
  - a Container binding

Each extra registers its layer via `addLayer`, and its binding via `addWranglerBinding` or `addAlchemyResource` with `when`.
**Blocked by:** 9

- [x] Turn on the Task 3 "every option has a folder" test; expect fail
- [x] Add the e2e case `house`: `postgres, drizzle, better-auth-orgs, alchemy, effect-ai-byok`, with every extra. This is the Spoorline stack. Expect fail
- [x] Implement each add-on; run unit tests and `pnpm test:e2e -t house`; expect pass. In CI, also check `docker build apps/browser`
- [x] Commit (one commit per add-on is fine)

### Task 11: Interactive prompts and `create` command

**Files:**
- Create `src/prompts/navigable.ts`, `src/prompts/flow.ts`, `src/commands/create.ts` and `src/bin.ts`.
- Delete `spike/`.
- Test `test/flow.test.ts`.

**Interfaces:**
- `askStack(flags: Partial<StackConfig>, io: PromptIO): Effect<StackConfig, Cancelled>`.
  - `PromptIO` is a service with `select`, `multiselect`, `text` and `confirm`. Each returns `Effect<Value | GoBack, Cancelled>`, and its live layer is clack-based.
  - It shows the sections Platform, Data and Features, in slot order.
  - A provided flag skips its prompt but is still validated against earlier answers.
  - `GoBack` re-asks the previous non-skipped slot.
  - Options come from `available`.
- `bin.ts`:
  - is an `effect/cli` root command
  - when invoked as `create-efforge`, or with no subcommand, runs `create`; it also has the subcommand `add`
  - `create` flags are `[name]`, one flag per slot (`--extras` comma-separated), `-y/--yes`, `--dry-run`, `--json`, `--no-install` and `--no-git`
- `create`:
  - runs validate → generate → (dry-run: print the tree paths, or JSON `{stack, command, files}`) → write → `pnpm install` → `git init` + initial commit
  - the outro prints `toCommand`

**Blocked by:** 4 (it can run in parallel with Tasks 6–10)

- [x] Write failing tests with a scripted `PromptIO` test layer:
  - The answer sequence with a back step yields the expected config.
  - `--database=none` means the orm and auth prompts are never shown.
  - `--auth=better-auth --database=none` fails with `IncompatibleStack`.
  - `-y` asks nothing.
  - `create --dry-run --json` prints valid JSON and writes nothing.
- [x] Implement; run `pnpm test`; expect pass. Run `node src/bin.ts` interactively once and record a short asciinema or a screenshot in the PR
- [x] Commit

### Task 12: `add` command

**Files:**
- Create `src/commands/add.ts`.
- Test `test/add.test.ts`.

**Interfaces:**
- `addAddons(dir: string, ids: string[], opts: { overwrite: boolean; dryRun: boolean }): Effect<AddResult, NotAnEfforgeProject | IncompatibleStack | OverlayConflict | TransformAnchorMissing, FileSystem>`.
- `AddResult = { written: string[]; transformed: string[]; skipped: string[] }`.
- It reads `efforge.jsonc` and computes the new stack (`ids` like `email` map to `extras/email`, and `ai=effect-ai-byok` sets the slot), then validates it.
- It generates only the new add-ons' overlays and transforms, against the current files on disk.
- Overlay conflict check: a target file that exists with a hash different from `efforge.jsonc.files[target]` is an `OverlayConflict{file, diff}`, unless `overwrite`.
- Transforms always run against the current content of seam files.
- It updates `efforge.jsonc`, then runs `pnpm install` unless `dryRun`.

**Blocked by:** 10, 11

- [ ] Write failing tests on a generated `pg-drizzle-orgs` tree in a tmp dir:
  - `add email` writes the Mailer files, and `layers.ts` contains `MailerLive`.
  - Running it twice changes nothing.
  - A user line added to `layers.ts` beforehand is kept.
  - An edited overlay target gives `OverlayConflict`, and `--overwrite` replaces it.
  - Deleting the `Layer.mergeAll` call gives `TransformAnchorMissing` with the snippet, and no files written.
  - `add database/d1` on a project with `database=postgres` fails with `IncompatibleStack` (one value per single-select slot).
- [ ] Implement; run; expect pass
- [ ] Commit

### Task 13: CI matrix and release prep

**Files:**
- Modify `.github/workflows/ci.yml`: add an `e2e` job with a matrix over the 8 curated stacks (`minimal`, `pg-drizzle`, `d1-effect-sql`, `pg-drizzle-orgs`, `pg-effect-sql-orgs`, `d1-drizzle-auth`, `pg-drizzle-orgs-alchemy`, `house`). Each job runs `pnpm test:e2e -t <stack>`. The `house` job also runs `docker build apps/browser`.
- Create `scripts/bump.ts`, which prints the current `npm view` latest versions next to the pins.
- Update `README.md` with usage, the slot table and `efforge add`.
- Create `CHANGELOG.md`.

**Blocked by:** 12

- [ ] Push a branch, open a PR, and see every matrix job pass
- [ ] Commit. Publishing to npm (`efforge` and `create-efforge`) waits for the user's `npm login` and explicit go-ahead

### Task 14: Regenerate Spoorline

**Files:** in `~/projects/spoorline`, on a Worktrunk branch `efforge-scaffold`, created with `wt switch --create efforge-scaffold`.

**Blocked by:** 13

- [ ] Run `node ~/projects/efforge/src/bin.ts spoorline-gen -y --database=postgres --orm=drizzle --auth=better-auth-orgs --infra=alchemy --ai=effect-ai-byok --extras=workflows,realtime,browser,storage,email --no-git` into a tmp dir
- [ ] Copy the generated tree over the worktree. Keep:
  - `packages/decoders`
  - `apps/cli`
  - `docs/`
  - `RESEARCH.md`
  - `LICENSE` (AGPL)
  - Spoorline's `README.md` sections, merged with the generated README

  Set the root package name to `spoorline-monorepo` and `license` to `AGPL-3.0-only`.
- [ ] Run `pnpm install && pnpm typecheck && pnpm test && pnpm build`; expect pass, with the 7 existing decoder tests passing
- [ ] Update `docs/architecture.md` to say the stack is generated by efforge (`efforge.jsonc` lists it)
- [ ] Commit on the branch. Merging and pushing to `ovriq/spoorline` wait for the user
