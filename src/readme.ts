import type { LoadedAddon } from "./addon.ts"
import { addonIdsFor } from "./addon.ts"
import { envGroups, localEnvFile, toFill } from "./env.ts"
import { INSTALL } from "./exec.ts"
import { matches } from "./generate.ts"
import { projectDirName } from "./projectName.ts"
import type { StackConfig } from "./stack.ts"
import { type Filled, fillRegions } from "./regions.ts"
import { pnpmVersion, versions } from "./versions.ts"

/**
 * The generated README.md is the template's prose plus regions efforge owns: the text between
 * `<!-- efforge:readme:<id> -->` and `<!-- /efforge:readme:<id> -->`. `create` fills them from the
 * stack and `add` rewrites them when the stack changes. Text outside them is the user's, and a
 * README without markers (an older project, or one the user rewrote) is never touched.
 */
export const README_FILE = "README.md"

export const README_REGIONS = [
  "about",
  "run",
  "scripts",
  "layout",
  "capabilities",
  "deploy",
  "more",
] as const
export type ReadmeRegion = (typeof README_REGIONS)[number]

export const README_PREFIX = "efforge:readme"

export interface ReadmeInput {
  readonly stack: StackConfig
  readonly addons: ReadonlyMap<string, LoadedAddon>
  /** Scripts of the root package.json, as the project has them (committed, unlike `.dev.vars`). */
  readonly scripts: Readonly<Record<string, string>>
}

/** One command to run after `create` or `add`, inside the project directory. */
export interface Step {
  readonly command: string
  readonly note?: string
  /** Runs until stopped (a dev server): start it in the background, don't wait for it. */
  readonly longRunning?: true
}

/**
 * What to run after `pnpm install` to see the app, in order, from the stack alone: one source for
 * the steps `create` and `add` print, their `--json` `nextSteps`, and the README's "Run it".
 */
export const runSteps = (stack: StackConfig): Step[] => {
  const alchemy = stack.infra === "alchemy"
  const steps: Step[] = []
  if (stack.database === "postgres") {
    steps.push({ command: "docker compose up -d --wait", note: "local Postgres" })
    steps.push({ command: "pnpm db:migrate", note: "create the tables" })
  }
  // alchemy dev applies D1 migrations to its local database itself
  if (stack.database === "d1" && !alchemy)
    steps.push({ command: "pnpm db:migrate", note: "create the tables in the local D1" })
  steps.push({
    command: "pnpm dev",
    note: alchemy ? "http://localhost:1337" : "http://localhost:5173",
    longRunning: true,
  })
  return steps
}

/** The steps that set up what the app needs before `pnpm dev` (a database, its tables). */
export const setupSteps = (stack: StackConfig): Step[] =>
  runSteps(stack).filter((s) => s.longRunning !== true)

/** What to run after `create`: the install when it was skipped, then {@link runSteps}. */
export const planSteps = (stack: StackConfig, o: { readonly installed: boolean }): Step[] => [
  ...(o.installed ? [] : [{ command: INSTALL }]),
  ...runSteps(stack),
]

/** `command  # note` lines, the notes aligned. */
export const renderSteps = (steps: ReadonlyArray<Step>): string[] => {
  const width = Math.max(...steps.map((s) => s.command.length))
  return steps.map((s) =>
    s.note === undefined ? s.command : `${s.command.padEnd(width)}  # ${s.note}`,
  )
}

/** A markdown table laid out the way the formatter (oxfmt, Prettier's markdown) leaves it. */
const table = (head: readonly [string, string], rows: ReadonlyArray<readonly [string, string]>) => {
  const all = [head, ...rows]
  const widths = [0, 1].map((i) => Math.max(3, ...all.map((r) => (r[i] as string).length)))
  const line = (cells: ReadonlyArray<string>) =>
    `| ${cells.map((c, i) => c.padEnd(widths[i] as number)).join(" | ")} |`
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n")
}

const code = (s: string) => `\`${s}\``

/** `a`, `a and b`, `a, b and c`. */
const and = (items: ReadonlyArray<string>): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] as string}`

const loaded = (input: ReadmeInput): LoadedAddon[] =>
  addonIdsFor(input.stack).flatMap((id) => {
    const a = input.addons.get(id)
    return a === undefined ? [] : [a]
  })

/** Env vars an add-on reads on this stack. */
const envOf = (a: LoadedAddon, stack: StackConfig): string[] =>
  a.manifest.envVars.filter((v) => matches(v.when, stack)).map((v) => v.name)

/** Every env var of the stack, in `.env.example` order, without duplicates. */
const allEnv = (input: ReadmeInput): string[] => [
  ...new Set(loaded(input).flatMap((a) => envOf(a, input.stack))),
]

const about = (input: ReadmeInput): string => {
  const { stack } = input
  const byId = (id: string) => input.addons.get(id)?.manifest.title ?? id
  const parts: string[] = []
  if (stack.database !== "none")
    parts.push(`${byId(`database/${stack.database}`)} with ${byId(`orm/${stack.orm}`)}`)
  if (stack.auth !== "none") parts.push(byId(`auth/${stack.auth}`))
  if (stack.ai !== "none") parts.push(byId(`ai/${stack.ai}`))
  for (const e of loaded(input).filter((a) => a.manifest.id.startsWith("extras/")))
    parts.push(e.manifest.title)
  const first =
    "A full-stack Effect 4 app on Cloudflare Workers, with TanStack Start for pages and server functions; every server capability is an Effect service with a layer."
  const infra =
    stack.infra === "alchemy"
      ? "`infra/alchemy.run.ts` (Alchemy) declares its Cloudflare resources"
      : "`wrangler.jsonc` declares its Cloudflare bindings"
  const second =
    parts.length === 0
      ? `It has no database or add-ons yet (see [Add more](#add-more)), and ${infra}.`
      : `It has ${and(parts)}, and ${infra}.`
  return `${first} ${second}`
}

const run = (input: ReadmeInput): string => {
  const { stack } = input
  const alchemy = stack.infra === "alchemy"
  const needs = [
    "Node 24.11+ (or 26+)",
    `pnpm ${pnpmVersion.split(".").slice(0, 2).join(".")}+`,
    ...(stack.database === "postgres" ? ["Docker, for the local Postgres"] : []),
  ]
  const out = [
    `You need ${and(needs)}.`,
    "",
    "```sh",
    ...renderSteps(planSteps(stack, { installed: false })),
    "```",
  ]
  const groups = envGroups(stack, input.addons)
  if (groups.length > 0) {
    const file = localEnvFile(stack)
    const fill = toFill(groups)
    out.push(
      "",
      `\`pnpm dev\` reads local settings from \`${file}\` (gitignored), which efforge wrote with values that work on your machine. In a fresh clone, create it first: \`cp .env.example ${file}\`${fill.length > 0 ? `, then fill in ${and(fill.map(code))}` : ""}.`,
    )
  }
  if (alchemy)
    out.push(
      "",
      "`pnpm dev` runs `alchemy dev`: Vite and workerd with the bindings declared in `infra/alchemy.run.ts`, on stage `dev_$USER`, with nothing created on Cloudflare.",
    )
  if (stack.database === "postgres")
    out.push(
      "",
      alchemy
        ? "Postgres on another port: change it in `docker-compose.yml` and in `DATABASE_URL` in `.env`, and run `pnpm db:migrate` with that `DATABASE_URL` set."
        : "Postgres on another port: change it in `docker-compose.yml` and in `localConnectionString` in `wrangler.jsonc`, and run `pnpm db:migrate` with `DATABASE_URL` set to the same database.",
    )
  if (stack.auth !== "none")
    out.push("", "Sign up at `/sign-up`; the dashboard at `/app` needs a signed-in user.")
  return out.join("\n")
}

/** Root scripts the README describes, in the order it lists them. */
const scriptRows = (stack: StackConfig): ReadonlyArray<[string, string, string]> => {
  const alchemy = stack.infra === "alchemy"
  const migrate =
    stack.database === "postgres"
      ? "Apply migrations to `DATABASE_URL` (default: the docker-compose database)"
      : alchemy
        ? "Not used with Alchemy: `pnpm dev` and `pnpm run deploy` apply the migrations"
        : "Apply migrations to the local D1 (`--remote`: the deployed one)"
  return [
    [
      "dev",
      "pnpm dev",
      alchemy
        ? "`alchemy dev`: the app with the bindings in `infra/alchemy.run.ts`"
        : "Dev server (Vite and workerd) at http://localhost:5173",
    ],
    ["build", "pnpm build", "Build every workspace"],
    [
      "typecheck",
      "pnpm typecheck",
      alchemy ? "Type-check every workspace and `infra/`" : "Type-check every workspace",
    ],
    ["check", "pnpm check", "Format check, lint and the Effect rules"],
    ["format", "pnpm format", "Apply formatting (oxfmt)"],
    ["lint", "pnpm lint", "Lint only (oxlint)"],
    ["test", "pnpm test", "Run the tests (`@effect/vitest`)"],
    [
      "db:generate",
      "pnpm db:generate",
      "Write a migration for a change to `packages/db/src/schema.ts` (drizzle-kit)",
    ],
    ["db:migrate", "pnpm db:migrate", migrate],
    [
      "deploy",
      "pnpm run deploy",
      alchemy
        ? "`alchemy deploy`: create or update a stage (see [Deploy](#deploy))"
        : "Build and deploy with wrangler (see [Deploy](#deploy))",
    ],
    ["destroy", "pnpm run destroy", "`alchemy destroy`: remove every resource of a stage"],
  ]
}

const scripts = (input: ReadmeInput): string =>
  table(
    ["Command", "What it does"],
    scriptRows(input.stack)
      .filter(([name]) => input.scripts[name] !== undefined)
      .map(([, command, what]) => [code(command), what] as const),
  )

const layout = (input: ReadmeInput): string => {
  const { stack } = input
  const has = (id: string) => addonIdsFor(stack).includes(id)
  const lines = [
    "`apps/web`: the TanStack Start app. Pages in `src/routes`, server code in `src/server` (layers composed in `src/server/layers.ts`), dashboard cards in `src/capabilities`.",
    "`packages/core`: the services (`Context.Service` tags), their tagged errors and schemas, and their tests in `packages/core/test`.",
  ]
  if (stack.database !== "none")
    lines.push(
      stack.orm === "drizzle"
        ? "`packages/db`: the database layer, the Drizzle schema (`src/schema.ts`) and the migrations drizzle-kit generates (`drizzle/`)."
        : "`packages/db`: the database layer and the SQL migrations (`migrations/NNNN_name.sql`).",
    )
  if (has("extras/browser"))
    lines.push("`apps/browser`: the Playwright server that runs in a Cloudflare Container.")
  lines.push(
    stack.infra === "alchemy"
      ? "`infra/alchemy.run.ts`: the Worker and every resource it binds (there is no `wrangler.jsonc`); `.github/workflows/deploy.yml` deploys it."
      : "`wrangler.jsonc`: the Worker and its bindings.",
  )
  if (stack.database === "postgres") lines.push("`docker-compose.yml`: the local Postgres.")
  if (allEnv(input).length > 0)
    lines.push("`.env.example`: every variable the add-ons read, with what each is for.")
  lines.push(
    "`efforge.jsonc`: the choices this project was made with; `efforge add` reads it.",
    "`AGENTS.md`: how to work in this code, for people and coding agents.",
    "`apps/web/public/favicon.svg`: efforge's mark as a placeholder icon; replace it with your own.",
  )
  return lines.map((l) => `- ${l}`).join("\n")
}

/** Where a layer imported by `layers.ts` lives: `./mailer` or `@repo/db`. */
const layerFile = (from: string): string =>
  from.startsWith("./")
    ? `apps/web/src/server/${from.slice(2)}.ts`
    : `packages/${from.replace(/^@repo\//, "")}/src/layer.ts`

export interface Capability {
  readonly title: string
  readonly service?: { readonly name: string; readonly file: string }
  readonly layer?: { readonly name: string; readonly file: string }
  readonly env: ReadonlyArray<string>
  readonly card?: string
}

/**
 * The capabilities of a stack, from the add-on manifests: the layer an add-on adds to
 * `layers.ts`, the service that layer provides (its `Live`/`Layer` suffix dropped, in a
 * `packages/core/src` file of the same name), its env vars and its card. The database and its ORM
 * are one capability; the runtime and infra add-ons are not capabilities.
 */
export const capabilities = (
  stack: StackConfig,
  addons: ReadonlyMap<string, LoadedAddon>,
): Capability[] => {
  const out: Capability[] = []
  const list = loaded({ stack, addons, scripts: {} })
  for (const a of list) {
    const m = a.manifest
    if (m.id === "base" || /^(runtime|infra|database)\//.test(m.id)) continue
    const add = m.transforms.find((t) => t.name === "addLayer" && matches(t.when, stack))
    const layerName = /^[A-Za-z_$][\w$]*/.exec(add?.args.layer ?? "")?.[0]
    const layer =
      layerName === undefined || add?.args.from === undefined
        ? undefined
        : { name: layerName, file: layerFile(add.args.from) }
    const serviceName = layer?.name.replace(/(Live|Layer)$/, "")
    const serviceFile =
      serviceName === undefined
        ? undefined
        : m.files.find(
            (f) =>
              matches(f.when, stack) &&
              f.target.toLowerCase() === `packages/core/src/${serviceName.toLowerCase()}.ts`,
          )?.target
    const database = m.id.startsWith("orm/")
      ? list.find((d) => d.manifest.id === `database/${stack.database}`)
      : undefined
    const module = m.card?.files[0]
    out.push({
      title:
        database === undefined ? m.title : `Database: ${database.manifest.title} with ${m.title}`,
      ...(serviceName === undefined || serviceFile === undefined
        ? {}
        : { service: { name: serviceName, file: serviceFile } }),
      ...(layer === undefined ? {} : { layer }),
      env: [...(database === undefined ? [] : envOf(database, stack)), ...envOf(a, stack)],
      ...(module !== undefined && matches(module.when, stack) ? { card: module.target } : {}),
    })
  }
  return out
}

const capabilityList = (input: ReadmeInput): string => {
  const base = input.addons.get("base")?.manifest.card?.files[0]?.target
  const lines = [
    `**Dashboard**: \`/app\` shows a card for each capability, with the code behind it. The cards are listed in \`apps/web/src/capabilities/registry.ts\`${base === undefined ? "" : `; ${code(base)} is the runtime's`}.`,
  ]
  for (const c of capabilities(input.stack, input.addons)) {
    const facts = [
      ...(c.service === undefined
        ? []
        : [`service ${code(c.service.name)} in ${code(c.service.file)}`]),
      ...(c.layer === undefined ? [] : [`layer ${code(c.layer.name)} in ${code(c.layer.file)}`]),
      ...(c.env.length === 0 ? [] : [`env ${c.env.map(code).join(", ")}`]),
      ...(c.card === undefined ? [] : [`card ${code(c.card)}`]),
    ]
    lines.push(`**${c.title}**: ${facts.join("; ")}.`)
  }
  return lines.map((l) => `- ${l}`).join("\n")
}

/** What `infra/alchemy.run.ts` creates for each add-on, beside the Worker. */
const alchemyResources = (stack: StackConfig): Record<string, string> => ({
  "database/postgres": "a Hyperdrive config for the Postgres at `DATABASE_URL`",
  "database/d1": `a D1 database (migrated from \`packages/db/${stack.orm === "drizzle" ? "drizzle" : "migrations"}\`)`,
  "extras/storage": "an R2 bucket",
  "extras/realtime": "the `Room` Durable Object",
  "extras/workflows": "the example Workflow",
  "extras/browser": "the browser Container (its image is built from `apps/browser` with Docker)",
  "extras/email": "an Email Sending binding",
})

const deployWrangler = (input: ReadmeInput): string => {
  const { stack } = input
  const ids = addonIdsFor(stack)
  const dir = projectDirName(stack.name)
  // DATABASE_URL is only for migrations: the Worker reaches Postgres through Hyperdrive
  const secrets = allEnv(input).filter((n) => n !== "DATABASE_URL")
  const pg = "postgres://USER:PASSWORD@HOST:5432/DB"
  const steps = ["Sign in: `pnpm exec wrangler login` (or set `CLOUDFLARE_API_TOKEN`)."]
  if (stack.database === "postgres")
    steps.push(
      `Create a Hyperdrive config for your production Postgres (reachable from the internet): \`pnpm exec wrangler hyperdrive create ${dir} --connection-string="${pg}" --binding HYPERDRIVE\`. With \`--binding\`, wrangler writes the new id into the \`HYPERDRIVE\` entry of \`wrangler.jsonc\` without asking (without it, the default answers add a second entry and leave \`HYPERDRIVE\` on the zeros): check that its \`id\` is no longer zeros. Then create the tables: \`DATABASE_URL="${pg}" pnpm db:migrate\`.`,
    )
  if (stack.database === "d1")
    steps.push(
      `Create the database: \`pnpm exec wrangler d1 create ${dir} --binding DB\`. With \`--binding\`, wrangler writes the new \`database_name\` and \`database_id\` into the \`DB\` entry of \`wrangler.jsonc\` without asking (without it, the default answers add a second entry and leave \`DB\` on the zeros): check that its \`database_id\` is no longer zeros. Then create the tables: \`pnpm db:migrate --remote\`.`,
    )
  if (ids.includes("extras/email"))
    steps.push(
      "Enable Email Sending for your domain, `pnpm exec wrangler email sending enable example.com`, and send from an address on it (`MAIL_FROM`).",
    )
  if (secrets.length > 0)
    steps.push(
      `Write the production values of ${and(secrets.map(code))} to \`.env.production\` (gitignored; \`.env.example\` says what each is), then upload them: \`pnpm exec wrangler secret bulk .env.production\` (before the first deploy, wrangler asks to create the Worker: answer yes).${secrets.includes("BETTER_AUTH_URL") ? " `BETTER_AUTH_URL` can stay empty until the first deploy prints the URL." : ""}`,
    )
  const notes = [
    ...(ids.includes("extras/storage") ? ["creates the R2 bucket"] : []),
    ...(ids.includes("extras/realtime") ? ["registers the `Room` Durable Object"] : []),
    ...(ids.includes("extras/workflows") ? ["registers the example Workflow"] : []),
  ]
  steps.push(
    `Deploy: \`pnpm run deploy\` (builds \`apps/web\`, then \`wrangler deploy\`).${notes.length > 0 ? ` The first deploy ${and(notes)}.` : ""}${ids.includes("extras/browser") ? " Docker must be running: the deploy builds the `apps/browser` image and pushes it (Containers need the Workers Paid plan)." : ""}`,
  )
  return [
    `\`wrangler.jsonc\` declares the Worker and its bindings. These steps follow wrangler ${versions.wrangler}'s own help; efforge's tests do not deploy to a Cloudflare account. \`pnpm run deploy --dry-run\` builds the app and checks the config without uploading (it does not check that the ids are real).`,
    "",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
  ].join("\n")
}

const deployAlchemy = (input: ReadmeInput): string => {
  const { stack } = input
  const ids = addonIdsFor(stack)
  const resources = Object.entries(alchemyResources(stack))
    .filter(([id]) => ids.includes(id))
    .map(([, r]) => r)
  const env = [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    ...allEnv(input).filter((n) => n !== "CLOUDFLARE_ACCOUNT_ID"),
  ]
  const steps = [
    `Write the production values of ${and(env.map(code))} to \`.env.production\` (gitignored; \`.env.example\` says what each is). Check that the Cloudflare credentials are set (not that they work) with \`pnpm exec alchemy provider check-env -c infra/alchemy.run.ts --env-file .env.production\`.${env.includes("BETTER_AUTH_URL") ? " `BETTER_AUTH_URL` can stay empty: Better Auth then takes the origin from each request." : ""}`,
  ]
  if (stack.database === "postgres")
    steps.push(
      'Create the tables in your production Postgres (reachable from the internet): `DATABASE_URL="postgres://USER:PASSWORD@HOST:5432/DB" pnpm db:migrate`.',
    )
  if (ids.includes("extras/email"))
    steps.push(
      "Enable Email Sending for your domain, `pnpm exec wrangler email sending enable example.com` (sign in first with `pnpm exec wrangler login`), and send from an address on it (`MAIL_FROM`).",
    )
  steps.push(
    `Deploy the \`prod\` stage: \`pnpm run deploy --stage prod --env-file .env.production\`. It prints the Worker's URL.${ids.includes("extras/browser") ? " Docker must be running to build the browser image (Containers need the Workers Paid plan)." : ""} Any other \`--stage\` name is a separate copy of everything; \`pnpm run destroy --stage <name> --env-file .env.production\` removes one.`,
    "In CI, `.github/workflows/deploy.yml` deploys `main` to `prod` and each pull request to its own stage; `infra/README.md` lists the repository secrets it needs. CI keeps Alchemy's state in a store on Cloudflare, while a deploy from your machine keeps it in `.alchemy/`: the two don't know about each other, and CI fails on resources a local `prod` deploy created. Deploy each stage from one place: once CI deploys `prod`, deploy from your machine only under another `--stage` name.",
  )
  return [
    `\`infra/alchemy.run.ts\` declares the Worker${resources.length > 0 ? ` and ${and(resources)}` : ""}; \`alchemy deploy\` creates or updates them. These steps follow alchemy ${versions.alchemy}'s own help; efforge's tests do not deploy to a Cloudflare account.`,
    "",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
  ].join("\n")
}

/** Extras that `add` takes alone, in the order "Add more" suggests them. */
const SUGGESTED = ["email", "storage", "realtime", "workflows", "browser"] as const

/** "Add more": `list`, and `add` with one add-on this project doesn't have yet. */
const more = (input: ReadmeInput): string => {
  const { stack } = input
  const next =
    SUGGESTED.find((e) => !stack.extras.includes(e)) ??
    (stack.infra === "none" ? "infra/alchemy" : undefined)
  return next === undefined
    ? "Every capability is an add-on, and this project has the ones that add alone. List them all:\n\n```sh\nnpx create-efforge list\n```"
    : `Every capability is an add-on. List them, then add one:\n\n\`\`\`sh\nnpx create-efforge list\nnpx create-efforge add ${next}\n\`\`\``
}

/** The content of every region for this project. */
export const readmeRegions = (input: ReadmeInput): Record<ReadmeRegion, string> => ({
  about: about(input),
  run: run(input),
  scripts: scripts(input),
  layout: layout(input),
  capabilities: capabilityList(input),
  deploy: input.stack.infra === "alchemy" ? deployAlchemy(input) : deployWrangler(input),
  more: more(input),
})

/**
 * `text` with the body of each region replaced (see `fillRegions`): `no-markers` for a README
 * without regions, `malformed` (and nothing replaced) when a marker is duplicated, unpaired, out of
 * order or nested.
 */
export const fillReadme = (text: string, regions: Readonly<Record<ReadmeRegion, string>>): Filled =>
  fillRegions(text, README_PREFIX, regions)

/** The one-line note `add` prints when it leaves the README as it is. */
export const readmeNote = (filled: Exclude<Filled, { kind: "filled" }>): string =>
  filled.kind === "no-markers"
    ? `${README_FILE} has no efforge:readme markers (made before efforge 0.3, or rewritten), so it was left as it is.`
    : `${README_FILE} was left as it is: ${filled.problems.join("; ")}. Keep one opening and one closing marker per region, each on a line of its own; the next efforge add rewrites the regions.`
