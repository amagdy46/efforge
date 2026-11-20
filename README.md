<!-- generated: header (pnpm brand) -->
<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/amagdy46/efforge/main/.github/assets/lockup-dark.svg">
    <img src="https://raw.githubusercontent.com/amagdy46/efforge/main/.github/assets/lockup-light.svg" width="300" height="72" alt="efforge logo: a maker's punch with ef struck through it, beside the word efforge">
  </picture>
</h1>
<!-- /generated -->

<p align="center">
  The maintained way to start a full-stack <a href="https://effect.website">Effect</a> app on Cloudflare.<br>
  Every capability is a layer you can add, see, test and upgrade.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/create-efforge"><img src="https://img.shields.io/npm/v/create-efforge" alt="npm version"></a>
  <a href="https://github.com/amagdy46/efforge/actions/workflows/ci.yml"><img src="https://github.com/amagdy46/efforge/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/amagdy46/efforge/blob/main/LICENSE"><img src="https://img.shields.io/github/license/amagdy46/efforge" alt="MIT license"></a>
</p>

<table>
<tr>
<th>You, at the prompts</th>
<th>A coding agent, no prompts</th>
</tr>
<tr>
<td>

```sh
npm create efforge my-app
```

</td>
<td>

```sh
npx -y create-efforge@latest create my-app --json --preset=ai
```

</td>
</tr>
</table>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/amagdy46/efforge/main/.github/assets/dashboard-dark.png">
  <img src="https://raw.githubusercontent.com/amagdy46/efforge/main/.github/assets/dashboard-light.png" width="830" alt="The database card of a new project's dashboard. Left, a working demo: a New note field, an Add note button and the stored notes. Right, the code behind it: createNote in packages/core/src/notes.ts, which fails with InvalidNote on a bad title and stores the note through the Notes service. Under the demo, who can call it: any signed-in user, and sign-up is open until you close it. Below, the files to read next: service, layer, test and the AGENTS.md section.">
</picture>

You get a TypeScript monorepo: a [TanStack Start](https://tanstack.com/start) app on Cloudflare Workers, its server side written in Effect. Its dashboard has a card per capability, a working demo beside the code behind it. Above is the database card.

It needs Node 24.11+ or 26+ and pnpm.

## See it run

<p align="center">
  <img src="https://raw.githubusercontent.com/amagdy46/efforge/main/.github/assets/demo.gif" width="760" alt="Terminal recording: npm create efforge my-app picks the AI preset at the first question, then writes, installs and commits the project in under ten seconds. In the new project, npx -y create-efforge add email adds the Mailer service and its dashboard card, and git diff shows the two lines it added to apps/web/src/server/layers.ts: the MailerLive import and MailerLive in AppLayer.">
</p>

Then start the app from the demo (the AI preset uses D1):

```sh
cd my-app
pnpm db:migrate   # create the tables in the local D1
pnpm dev          # http://localhost:5173
```

With Postgres, `docker compose up -d --wait` comes first; `create` prints the steps for your stack.

## The idea

In Effect, a **service** is a named interface your code asks for, and a **layer** is the code that implements it. efforge builds every server capability that way:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/amagdy46/efforge/main/docs/assets/layers-dark.svg">
  <img src="https://raw.githubusercontent.com/amagdy46/efforge/main/docs/assets/layers-light.svg" width="520" alt="Diagram: the Notes interface; NotesLive implements it and is listed in AppLayer; in a test, NotesInMemory implements it instead and layer(NotesInMemory) provides it. Why your app is shaped like this, linked below, gives the same facts as a list.">
</picture>

Interfaces and their tagged errors (errors with a name the compiler knows, such as `InvalidNote`) live in `packages/core`. Only `apps/web/src/server/cloudflare.ts` reads the Worker's environment, so the rest runs in plain Node under `@effect/vitest`. [Why your app is shaped like this](https://github.com/amagdy46/efforge/blob/main/docs/architecture.md) walks through it, with the diagram as text.

## Add, see, test, upgrade

**Add.** `efforge add` wires a capability into a project you already have. It parses each file it edits and changes the syntax tree, so your formatting and the code around the change stay as they were. It records a hash of each file it wrote, and refuses to overwrite one you changed. `add email` writes the `Mailer` service, its layer, a test and a dashboard card, and adds the layer to the app:

```sh
npx -y create-efforge add email
```

<!-- diff: apps/web/src/server/layers.ts after add email -->
```diff
+import { MailerLive } from "./mailer"
 ...
 export const AppLayer = Layer.mergeAll(
 ...
+  MailerLive,
   /* efforge:layers */
 )
```

**See.** Besides the dashboard, `npx -y create-efforge graph` prints the layers `AppLayer` merges, with what each provides and needs, as Mermaid for a README or a pull request.

**Test.** Code asks for a service, never a layer, so a test swaps the layer. Each capability comes with a test layer and a test that uses it. From `packages/core/test/notes.test.ts`, in every project with a database:

<!-- sample: packages/core/test/notes.test.ts -->
```ts
layer(NotesInMemory)("createNote", (it) => {
  it.effect("stores the trimmed title", () =>
    Effect.gen(function* () {
      const note = yield* createNote("  Buy milk ")
      expect(note.title).toBe("Buy milk")
      const notes = yield* Notes
      expect(yield* notes.list).toContainEqual(note)
    }),
  )
```

[Swap a layer to test](https://github.com/amagdy46/efforge/blob/main/docs/testing.md) has the rest.

**Upgrade.** `doctor` says what is wrong with a checkout and the command that fixes it. `upgrade` moves the project to the newest pins and templates. It changes only what it can prove is still efforge's, and lists the files of yours it kept.

```sh
npx -y create-efforge@latest doctor
npx -y create-efforge@latest upgrade --check
npx -y create-efforge@latest upgrade
```

[Keep a project current](https://github.com/amagdy46/efforge/blob/main/docs/upgrading.md) walks a project from efforge 0.2.0 forward.

## Pick your stack

The first question offers a preset, a whole stack in one choice, or each part in turn. Every answer is also a flag.

| Preset | Stack |
|---|---|
| `saas` | Postgres, Drizzle, Better Auth with organizations, email and storage |
| `ai` | D1, Effect SQL, Better Auth, AI with your own key, and realtime |
| `minimal` | No database and no auth: the app, its layers and the dashboard |

`npx -y create-efforge my-app --yes --preset=saas --database=d1` takes a preset with one part changed. Or set the parts:

| Part | Flag values | Default |
|---|---|---|
| Database | `--database=postgres` (via Hyperdrive), `d1`, `none` | `postgres` |
| ORM | `--orm=drizzle`, `effect-sql`, `none` | `drizzle` |
| Auth | `--auth=better-auth-orgs`, `better-auth`, `none` | `better-auth-orgs` |
| Infrastructure | `--infra=none` (`wrangler.jsonc`), `alchemy` | `none` |
| AI | `--ai=none`, `effect-ai-byok` | `none` |
| Extras | `--extras=workflows,realtime,browser,storage,email,rpc`, and `cluster` ([experimental](https://github.com/amagdy46/efforge/blob/main/docs/cluster.md)) | none |

An ORM goes with a database, and auth needs one. Postgres needs Docker on your machine; D1 doesn't. `--yes` takes the defaults for the rest, and `create` ends with the command that makes the same stack again. [The CLI reference](https://github.com/amagdy46/efforge/blob/main/docs/cli.md) has every flag.

## For coding agents

Tell your agent to use efforge, or install the skill: `npx -y skills add amagdy46/efforge --yes`. They need create-efforge 0.3.0 or later, whose documents all carry `contract: 1`. `--json` never prompts and prints one JSON document. On failure, `error.fix` is a command that does what was asked, or `null` with the values to choose from (and, when there are several ways out, `alternatives`: complete commands, one per way).

```sh
npx -y create-efforge@latest create my-app --json --database=d1 --auth=better-auth
npx -y create-efforge@latest list --json --cwd my-app
npx -y create-efforge@latest info email --json --cwd my-app
npx -y create-efforge@latest add email --json --cwd my-app
npx -y create-efforge@latest graph --json --cwd my-app
npx -y create-efforge@latest doctor --json --cwd my-app
```

A typo, for example `add emial --json --cwd my-app`, prints (shortened):

<!-- json: npx -y create-efforge@latest add emial --json --cwd my-app -->
```json
{
  "contract": 1,
  "ok": false,
  "error": {
    "code": "UnknownAddon",
    "fix": "npx -y create-efforge add extras/email --json --cwd my-app",
    "suggestions": ["extras/email"]
  }
}
```

Then, in `my-app`: `pnpm typecheck && pnpm check && pnpm test && pnpm build`. The skill ([skills/efforge/SKILL.md](https://github.com/amagdy46/efforge/blob/main/skills/efforge/SKILL.md)) says what each error means; [docs/json.md](https://github.com/amagdy46/efforge/blob/main/docs/json.md) is the full contract, and [llms.txt](https://github.com/amagdy46/efforge/blob/main/llms.txt) lists the docs. The generated `AGENTS.md` gives an agent the project's layout and rules.

## What you get

```
apps/web          TanStack Start app: routes, dashboard, shadcn/ui, Tailwind v4
packages/core     service interfaces, tagged errors, schemas, and their tests
packages/db       schema, migrations, database layer     (with a database)
infra/            alchemy.run.ts                         (infra=alchemy)
apps/browser      Playwright container image             (extras=browser)
efforge.jsonc     your stack, and a hash of each file efforge wrote
AGENTS.md         layout and rules for coding agents
```

With auth, every server function and every route under `/api/` refuses a caller without a session. The exceptions are sign-in, the session check and the landing page's stack, listed in `apps/web/src/server/public-*.json`. Sign-up is open until you close it: anyone can register and then use every card, the ones that spend your AI key included. `disableSignUp: true` in `apps/web/src/server/auth.ts` closes it.

The project's README has the first deploy for its stack, and [Deploy](https://github.com/amagdy46/efforge/blob/main/docs/deploy.md) explains it. There is no telemetry.

## Status

efforge is young. Cloudflare is the only runtime, add-ons can be added but not removed, and Drizzle and Alchemy are pinned to pre-releases. Only the `--json` output is versioned. CI builds and tests a matrix of generated stacks on every change; nothing deploys to a real account. Details: [Status and limits](https://github.com/amagdy46/efforge/blob/main/docs/limits.md).

Use something else if you want Next.js, a runtime other than Cloudflare, or plain async code without Effect: `npm create cloudflare` for TanStack Start on Workers without Effect, [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack) for many other stacks, or [Alchemy's examples](https://github.com/alchemy-run/alchemy) for Effect on Cloudflare without an app around it.

## Docs

[All docs](https://github.com/amagdy46/efforge/blob/main/docs/README.md), in reading order; the [add-on pages](https://github.com/amagdy46/efforge/blob/main/docs/addons/README.md); the [CLI reference](https://github.com/amagdy46/efforge/blob/main/docs/cli.md); [contributing](https://github.com/amagdy46/efforge/blob/main/CONTRIBUTING.md) and the [changelog](https://github.com/amagdy46/efforge/blob/main/CHANGELOG.md).

efforge is not affiliated with Effect or the Effect team. Prompts by [Clack](https://github.com/bombshell-dev/clack). MIT licensed.
