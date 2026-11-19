# Deploy

Your project's README has a Deploy section with the steps for its own stack, in order. This page explains the same steps once, with the reasons, for both ways a project declares its Cloudflare resources: `wrangler.jsonc` (the default) or Alchemy (`--infra=alchemy`). The commands here are the ones the generated READMEs use, and a test fails when the two disagree.

What was checked: efforge's tests do not deploy to a Cloudflare account. The steps follow the help of the wrangler and Alchemy versions efforge pins; `pnpm run deploy --dry-run`, which builds the app and checks the config without uploading, is what was run.

Some words first:

- A **Worker** is your app as Cloudflare runs it. The deploy builds `apps/web` and uploads it as one Worker.
- A **binding** is how the Worker reaches a Cloudflare resource, such as a D1 database or an R2 bucket. The code reads bindings through layers ([why](architecture.md#two-places-where-cloudflare-and-effect-meet)).
- A **secret** is a setting whose value must not be in the code, such as `BETTER_AUTH_SECRET`. Locally it is in `.dev.vars` (`.env` with Alchemy); in production Cloudflare stores it.

## With wrangler

`wrangler.jsonc` lists the Worker and its bindings. A new project's resource ids in it are zeros: the steps below create the real resources and write their ids back.

### 1. Sign in

`pnpm exec wrangler login` opens a browser. In CI, set `CLOUDFLARE_API_TOKEN` instead.

### 2. Create the database

D1: `pnpm exec wrangler d1 create my-app --binding DB`. With `--binding DB`, wrangler writes the new database's name and id into the `DB` entry of `wrangler.jsonc`. Without it, wrangler asks, and its default answers add a second entry and leave `DB` on the zeros. Check that `database_id` is no longer zeros. Then create the tables in it: `pnpm db:migrate --remote`.

Postgres: Workers reach Postgres through Hyperdrive, Cloudflare's connection pool, so you create a Hyperdrive config that points at your database. The database must be reachable from the internet. `pnpm exec wrangler hyperdrive create my-app --connection-string="postgres://USER:PASSWORD@HOST:5432/DB" --binding HYPERDRIVE` writes the new id into the `HYPERDRIVE` entry, in the same way. Then create the tables: `DATABASE_URL="postgres://USER:PASSWORD@HOST:5432/DB" pnpm db:migrate`. `DATABASE_URL` is only for migrations; the Worker never reads it.

No database: skip this step.

### 3. Enable email (with the email add-on)

Cloudflare sends email only from a domain you have enabled for Email Sending: `pnpm exec wrangler email sending enable example.com`, with your domain. Set `MAIL_FROM` to an address on it.

### 4. Upload the secrets

Write the production values to `.env.production`. It is gitignored, and `.env.example` says what each one is. Generate new secrets; don't reuse the local ones. Then upload them all at once: `pnpm exec wrangler secret bulk .env.production`. Before the first deploy there is no Worker to attach them to, so wrangler offers to create it: answer yes.

`BETTER_AUTH_URL`, the app's public address, can stay empty until the first deploy prints it.

### 5. Deploy

`pnpm run deploy` builds `apps/web`, then runs `wrangler deploy`. It prints the Worker's URL. The first deploy also creates what `wrangler.jsonc` declares and nothing else had to: the R2 bucket for storage, the `Room` Durable Object for realtime, the example Workflow.

With the browser add-on, Docker must be running: the deploy builds the `apps/browser` image and pushes it. Containers need the Workers Paid plan.

`pnpm run deploy --dry-run` does everything but the upload. It does not check that the ids in `wrangler.jsonc` are real.

## With Alchemy

`infra/alchemy.run.ts` declares the Worker and every resource it binds, in TypeScript; there is no `wrangler.jsonc`. `alchemy deploy` creates what is missing and updates what changed, so there are no ids to copy. A **stage** is one named copy of everything: `prod`, or one per pull request.

### 1. Write the settings

Write the production values of `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and your app's settings to `.env.production` (gitignored; `.env.example` says what each one is). This file is everything the deploy reads. `pnpm exec alchemy provider check-env -c infra/alchemy.run.ts --env-file .env.production` checks that the Cloudflare credentials are set, not that they work.

`BETTER_AUTH_URL` can stay empty: Better Auth then takes the address from each request.

### 2. Prepare what Alchemy doesn't create

Postgres: Alchemy creates the Hyperdrive config, but not the database or its tables. Create the tables in your production Postgres, reachable from the internet: `DATABASE_URL="postgres://USER:PASSWORD@HOST:5432/DB" pnpm db:migrate`. D1 needs nothing: the deploy creates the database and applies the migrations.

Email: enable your domain as in the wrangler steps, `pnpm exec wrangler email sending enable example.com`, after `pnpm exec wrangler login`.

### 3. Deploy a stage

`pnpm run deploy --stage prod --env-file .env.production` deploys the `prod` stage and prints the Worker's URL. With the browser add-on, Docker must be running to build its image, and Containers need the Workers Paid plan.

Another `--stage` name makes a separate copy of everything. `pnpm run destroy --stage <name> --env-file .env.production` removes one.

### 4. Deploy from CI, or from your machine, not both

`.github/workflows/deploy.yml` deploys `main` to `prod` and each pull request to its own stage; `infra/README.md` lists the repository secrets it needs. Alchemy records what it created: CI keeps that record in a store on Cloudflare, a deploy from your machine keeps it in `.alchemy/`. The two records don't know about each other, so CI fails on resources a deploy from your machine created. Once CI deploys `prod`, deploy from your machine only under another stage name.

## After the first deploy

- Sign up on the deployed app and open the dashboard: its cards now run against the real resources.
- Change a layer, run `pnpm run deploy` again (with Alchemy, the same `--stage`). Migrations you add later: `pnpm db:migrate --remote` on D1 with wrangler, the same `DATABASE_URL="postgres://USER:PASSWORD@HOST:5432/DB" pnpm db:migrate` on Postgres, nothing with Alchemy on D1 (the deploy applies them).
- An add-on added later can need a new resource or secret: `efforge add` lists its env vars, and the README's Deploy section is rewritten for the new stack.
