import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { afterEach, beforeEach, expect, it } from "@effect/vitest"
import { Effect, type Layer } from "effect"
import { loadAddons } from "../src/addon.ts"
import { addAddons } from "../src/commands/add.ts"
import { defaultTemplatesDir } from "../src/commands/create.ts"
import { generate } from "../src/generate.ts"
import {
  capabilities,
  deployResources,
  fillReadme,
  planSteps,
  README_REGIONS,
  readmeRegions,
  renderSteps,
} from "../src/readme.ts"
import { slots } from "../src/slots.ts"
import { type StackConfig, withDefaults } from "../src/stack.ts"
import { writeTree } from "../src/write.ts"
import { repo } from "../scripts/brand/source.ts"

// Against the real templates/: the README regions, the AGENTS.md sections and the docs links.

const run = <A, E>(eff: Effect.Effect<A, E, Layer.Success<typeof NodeServices.layer>>) =>
  Effect.runPromise(eff.pipe(Effect.provide(NodeServices.layer)))

const addons = () => run(loadAddons(defaultTemplatesDir))
const generated = (config: StackConfig) =>
  run(
    Effect.gen(function* () {
      return yield* generate(config, yield* loadAddons(defaultTemplatesDir))
    }),
  )

const minimal = withDefaults({ name: "app", database: "none", orm: "none", auth: "none" })
const pg = withDefaults({ name: "app" })
const house = withDefaults({
  name: "app",
  infra: "alchemy",
  ai: "effect-ai-byok",
  extras: ["workflows", "realtime", "browser", "storage", "email"],
})
const d1 = withDefaults({
  name: "app",
  database: "d1",
  orm: "effect-sql",
  auth: "better-auth",
  extras: ["storage", "email"],
})

/** The text of region `id` in `readme`. */
const region = (readme: string, id: string) => {
  const start = readme.indexOf(`<!-- efforge:readme:${id} -->`)
  const end = readme.indexOf(`<!-- /efforge:readme:${id} -->`)
  expect(start, id).toBeGreaterThan(-1)
  expect(end, id).toBeGreaterThan(start)
  return readme.slice(start, end)
}

let tmp: string
let dir: string
beforeEach(() => {
  tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "efforge-readme-"))
  dir = join(tmp, "app")
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const readme = () => readFileSync(join(dir, "README.md"), "utf8")
const opts = { overwrite: false, dryRun: false, install: false }

for (const [name, config] of [
  ["minimal", minimal],
  ["pg", pg],
  ["d1", d1],
  ["house", house],
] as const)
  it(`${name}: every region is filled from the stack, and the scripts table matches package.json`, async () => {
    const tree = await generated(config)
    const text = tree.get("README.md") as string
    for (const id of README_REGIONS) expect(region(text, id).trim().length, id).toBeGreaterThan(60)
    const scripts = Object.keys(JSON.parse(tree.get("package.json") as string).scripts)
    const rows = [...region(text, "scripts").matchAll(/^\| `pnpm (?:run )?([\w:]+)`/gm)].map(
      (m) => m[1],
    )
    expect(rows.length).toBeGreaterThan(5)
    for (const row of rows) expect(scripts, row).toContain(row)
    for (const script of scripts.filter((s) => s !== "prepare"))
      expect(rows, script).toContain(script)
    // the README is a seam: `add` rewrites it, so efforge.jsonc does not hash it
    expect(tree.get("efforge.jsonc")).not.toContain('"README.md"')
  })

it("the run steps are the ones each stack needs", async () => {
  const steps = async (c: StackConfig) =>
    region((await generated(c)).get("README.md") as string, "run")
  expect(await steps(minimal)).not.toContain("db:migrate")
  const postgres = await steps(pg)
  expect(postgres.indexOf("docker compose up -d --wait")).toBeLessThan(
    postgres.indexOf("pnpm db:migrate"),
  )
  expect(postgres).toContain("`pnpm dev` reads local settings from `.dev.vars`")
  expect(postgres).toContain("cp .env.example .dev.vars")
  expect(await steps(d1)).toContain("pnpm db:migrate")
  // efforge writes .env itself on Alchemy: nothing to copy on the machine that ran create
  const alchemy = await steps(house)
  expect(alchemy).not.toContain("cp .dev.vars")
  expect(alchemy).toContain("cp .env.example .env")
  expect(alchemy).not.toContain("fill in")
  // without organizations the AI key is one the app reads: a secret to fill in
  expect(await steps({ ...house, auth: "better-auth" })).toContain(
    "`cp .env.example .env`, then fill in `LLM_API_KEY`.",
  )
  expect(alchemy).toContain("http://localhost:1337")
  // alchemy dev migrates a local D1 itself; db:migrate needs a wrangler.jsonc
  expect(await steps({ ...d1, infra: "alchemy" })).not.toContain("db:migrate")
  // one source: the README's commands are the ones create prints and --json gives as nextSteps
  for (const c of [minimal, pg, d1, house, { ...d1, infra: "alchemy" as const }]) {
    const block = /```sh\n([\s\S]*?)\n```/.exec(await steps(c))?.[1]
    expect(block).toBe(renderSteps(planSteps(c, { installed: false })).join("\n"))
  }
})

it("every add-on that binds a Cloudflare resource is covered by Deploy, on both infras", async () => {
  const bound = [...(await addons()).values()]
    .map((a) => a.manifest)
    .filter((m) => m.transforms.some((t) => t.name === "addWranglerBinding"))
  expect(bound.length).toBeGreaterThan(5)
  for (const m of bound)
    for (const infra of ["none", "alchemy"] as const) {
      const [slot, value] = m.id.split("/") as [string, string]
      const config = withDefaults({
        name: "app",
        infra,
        database: slot === "database" ? value : "d1",
        orm: "drizzle",
        auth: "none",
        extras: slot === "extras" ? [value] : [],
      } as Parameters<typeof withDefaults>[0])
      const entry = deployResources(config)[m.id]
      expect(entry, `${m.id} has no entry in deployResources (src/readme.ts)`).toBeDefined()
      const text = region((await generated(config)).get("README.md") as string, "deploy")
      expect(text, `${m.id} on infra=${infra}`).toContain(
        infra === "alchemy" ? entry?.alchemy : entry?.wrangler,
      )
    }
})

it("deploy follows the infra: wrangler resources and secrets, or Alchemy stages", async () => {
  const deploy = async (c: StackConfig) =>
    region((await generated(c)).get("README.md") as string, "deploy")
  const wrangler = await deploy(d1)
  expect(wrangler).toContain("pnpm exec wrangler d1 create app --binding DB")
  expect(wrangler).toContain("pnpm db:migrate --remote")
  expect(wrangler).toContain("pnpm exec wrangler email sending enable")
  expect(wrangler).toContain("pnpm exec wrangler secret bulk .env.production")
  // wrangler's prompts, and what to answer
  expect(wrangler).toContain("wrangler asks to create the Worker: answer yes")
  expect(wrangler).toContain("check that its `database_id` is no longer zeros")
  expect(wrangler).toContain("pnpm run deploy")
  expect(wrangler).not.toContain("alchemy")
  expect(await deploy(pg)).toMatch(
    /pnpm exec wrangler hyperdrive create app --connection-string="[^"]+" --binding HYPERDRIVE/,
  )
  expect(await deploy(minimal)).not.toContain("secret bulk")
  const alchemy = await deploy(house)
  expect(alchemy).toContain("pnpm run deploy --stage prod --env-file .env.production")
  expect(alchemy).toContain("Hyperdrive")
  expect(alchemy).toContain("R2 bucket")
  expect(alchemy).not.toContain("wrangler.jsonc")
  // a local prod deploy and CI's prod keep separate state
  expect(alchemy).toContain("CI keeps Alchemy's state in a store on Cloudflare")
  expect(alchemy).toContain("Deploy each stage from one place")
  // honest about what was not run
  for (const text of [wrangler, alchemy])
    expect(text).toContain("efforge's tests do not deploy to a Cloudflare account")
})

it("every capability names a service and a layer that exist in the generated code", async () => {
  const loaded = await addons()
  for (const config of [pg, d1, house, { ...house, auth: "better-auth" as const }]) {
    const tree = await generated(config)
    const found = capabilities(config, loaded)
    // database, auth, ai and each extra
    expect(found.length).toBe(2 + (config.ai === "none" ? 0 : 1) + config.extras.length)
    for (const c of found) {
      expect(c.service, c.title).toBeDefined()
      expect(c.layer, c.title).toBeDefined()
      expect(tree.get(c.service?.file ?? ""), c.title).toMatch(
        new RegExp(`class ${c.service?.name}\\b`),
      )
      expect(tree.get(c.layer?.file ?? ""), c.title).toMatch(
        new RegExp(`export const ${c.layer?.name}\\b`),
      )
      if (c.card !== undefined) expect(tree.has(c.card), c.card).toBe(true)
    }
  }
})

it("add rewrites the regions to match the new stack and keeps the user's text", async () => {
  await run(writeTree(dir, await generated(pg)))
  const mine = readme()
    .replace("## Run it\n", "## Run it\n\nOur team runs this on a shared VM.\n")
    .replace("## Add more", "## Our notes\n\nAsk Sam before deploying.\n\n## Add more")
    .replace("# app\n", "# Our app\n")
  writeFileSync(join(dir, "README.md"), mine)

  const result = await run(addAddons(dir, ["email"], opts))
  expect(result.transformed).toContain("README.md")
  const after = readme()
  expect(after).toContain("Our team runs this on a shared VM.")
  expect(after).toContain("## Our notes\n\nAsk Sam before deploying.")
  expect(after.split("\n")[0]).toBe("# Our app")
  expect(region(after, "capabilities")).toContain("**Email**")
  expect(region(after, "capabilities")).toContain("`MAIL_FROM`")
  expect(region(after, "deploy")).toContain("wrangler email sending enable")
  expect(region(after, "about")).toContain("Email")
  // outside the regions, nothing but the regions changed
  const strip = (t: string) =>
    t.replace(/(<!-- efforge:readme:(\w+) -->)[\s\S]*?(<!-- \/efforge:readme:\2 -->)/g, "$1$3")
  expect(strip(after)).toBe(strip(mine))
  // it equals what create writes for that stack, user text aside
  const fresh = (await generated({ ...pg, extras: ["email"] })).get("README.md") as string
  for (const id of README_REGIONS) expect(region(after, id)).toBe(region(fresh, id))
})

it("a README without markers is left alone, and add says so in one line", async () => {
  await run(writeTree(dir, await generated(pg)))
  writeFileSync(join(dir, "README.md"), "# Ours\n\nWe wrote this.\n")
  const result = await run(addAddons(dir, ["email"], opts))
  expect(readme()).toBe("# Ours\n\nWe wrote this.\n")
  expect(result.transformed).not.toContain("README.md")
  expect(result.written).not.toContain("README.md")
  expect(result.notes.filter((n) => n.includes("README.md"))).toHaveLength(1)
})

it("a region whose markers the user deleted keeps their text", async () => {
  await run(writeTree(dir, await generated(pg)))
  const deploy = region(readme(), "deploy")
  const mine = readme().replace(
    `${deploy}<!-- /efforge:readme:deploy -->`,
    "We deploy with our own pipeline.",
  )
  writeFileSync(join(dir, "README.md"), mine)
  await run(addAddons(dir, ["storage"], opts))
  expect(readme()).toContain("We deploy with our own pipeline.")
  expect(readme()).not.toContain("efforge:readme:deploy")
  expect(region(readme(), "capabilities")).toContain("**Storage**")
})

it("fillReadme fills nothing when a region is unclosed, and says there are no markers", async () => {
  const regions = readmeRegions({ stack: pg, addons: await addons(), scripts: {} })
  expect(fillReadme("# x\n", regions)).toEqual({ kind: "no-markers" })
  const half = "<!-- efforge:readme:about -->\nmine\n"
  expect(fillReadme(half, regions)).toEqual({
    kind: "malformed",
    problems: ["<!-- efforge:readme:about --> (line 1) has no <!-- /efforge:readme:about -->"],
  })
})

it("add tells where each new add-on's card, AGENTS.md sections and docs are", async () => {
  await run(writeTree(dir, await generated(minimal)))
  const result = await run(addAddons(dir, ["database/d1", "orm/drizzle", "realtime"], opts))
  const byId = new Map(result.added.map((a) => [a.id, a]))
  expect(byId.get("orm/drizzle")?.card).toBe("apps/web/src/capabilities/database.tsx")
  expect(byId.get("orm/drizzle")?.agents).toEqual([
    "Queries and migrations (Drizzle)",
    "Notes without auth",
  ])
  expect(byId.get("database/d1")?.agents).toEqual(["Database (Cloudflare D1)"])
  expect(byId.get("extras/realtime")?.card).toBe("apps/web/src/capabilities/realtime.tsx")
  expect(byId.get("extras/realtime")?.docs).toBe(
    `${repo.url}/blob/main/docs/addons/extras-realtime.md`,
  )
  const agents = readFileSync(join(dir, "AGENTS.md"), "utf8")
  expect(agents).toContain("## Queries and migrations (Drizzle)")
  expect(agents).toContain("pnpm db:migrate --remote")
})

it("every add-on links its page in efforge's docs", async () => {
  const loaded = await addons()
  for (const slot of slots)
    for (const option of slot.options.filter((o) => o.id !== "none")) {
      const m = loaded.get(`${slot.id}/${option.id}`)?.manifest
      expect(m?.docs, m?.id).toBe(`${repo.url}/blob/main/docs/addons/${slot.id}-${option.id}.md`)
      // and the page is there, in this repo, so the link resolves once it is on main
      const page = new URL(`../docs/addons/${slot.id}-${option.id}.md`, import.meta.url)
      expect(readFileSync(page, "utf8"), m?.id).toContain(`# ${m?.title}`)
    }
  // every add-on, the base and runtime included, has a link that resolves
  for (const [id, a] of loaded) {
    if (a.manifest.docs === undefined) continue
    const rel = a.manifest.docs.replace(`${repo.url}/blob/main/`, "../")
    expect(() => readFileSync(new URL(rel, import.meta.url)), id).not.toThrow()
  }
})

it("the ORM, database and Alchemy add-ons each bring an AGENTS.md section", async () => {
  const agents = async (c: StackConfig) => (await generated(c)).get("AGENTS.md") as string
  const h = await agents(house)
  expect(h).toContain("## Database (Postgres)")
  expect(h).toContain("## Queries and migrations (Drizzle)")
  expect(h).toContain("## Infrastructure (Alchemy)")
  expect(h).toContain("There is no `wrangler.jsonc`")
  expect(h).not.toContain("`HYPERDRIVE` is declared in `wrangler.jsonc`")
  // Alchemy reads local settings from .env: no section may send anyone to .dev.vars
  expect(h).not.toContain(".dev.vars")
  expect(await agents({ ...d1, infra: "alchemy" })).not.toContain(".dev.vars")
  const s = await agents(d1)
  expect(s).toContain("## Database (Cloudflare D1)")
  expect(s).toContain("## Queries and migrations (Effect SQL)")
  expect(s).not.toContain("Infrastructure (Alchemy)")
  expect((await agents(minimal)).match(/efforge:section:/g)).toBeNull()
})

// the review's three ways a marker string occurring twice cost user text (W2-D, B2)
for (const [name, damage, problem] of [
  [
    "a marker quoted in prose above its region",
    (t: string) =>
      t.replace("## Run it", "Do not remove `<!-- efforge:readme:run -->` below.\n\n## Run it"),
    undefined,
  ],
  [
    "an opening marker twice, with the user's text between",
    (t: string) =>
      t.replace(
        "<!-- efforge:readme:run -->",
        "<!-- efforge:readme:run -->\n\nOur note between.\n\n<!-- efforge:readme:run -->",
      ),
    "<!-- efforge:readme:run --> appears 2 times",
  ],
  [
    "a closing marker gone, and a second pair lower down",
    (t: string) =>
      `${t.replace("<!-- /efforge:readme:run -->", "")}\n## Appendix\n\nOurs.\n\n<!-- efforge:readme:run -->\n\nold\n\n<!-- /efforge:readme:run -->\n`,
    "<!-- efforge:readme:run --> appears 2 times",
  ],
] as const)
  it(`add keeps every user line when ${name}`, async () => {
    await run(writeTree(dir, await generated(minimal)))
    const mine = damage(readme())
    writeFileSync(join(dir, "README.md"), mine)
    const result = await run(addAddons(dir, ["database/d1", "orm/drizzle"], opts))
    const note = result.notes.find((n) => n.startsWith("README.md"))
    if (problem === undefined) {
      // prose, not a marker: the regions are rewritten and the sentence stays
      expect(note).toBeUndefined()
      expect(readme()).toContain("Do not remove `<!-- efforge:readme:run -->` below.\n\n## Run it")
      expect(region(readme(), "run")).toContain("pnpm db:migrate")
    } else {
      expect(readme()).toBe(mine)
      expect(note).toContain(problem)
    }
  })

it("add leaves a broken AGENTS.md alone and names the marker", async () => {
  await run(writeTree(dir, await generated(pg)))
  const path = join(dir, "AGENTS.md")
  const mine = readFileSync(path, "utf8").replace(
    "<!-- /efforge:section:database -->",
    "<!-- /efforge:section:database -->\n\n<!-- /efforge:section:database -->",
  )
  writeFileSync(path, mine)
  const result = await run(addAddons(dir, ["email"], opts))
  expect(readFileSync(path, "utf8")).toBe(mine)
  expect(result.notes.find((n) => n.startsWith("AGENTS.md"))).toContain(
    "<!-- /efforge:section:database --> appears 2 times",
  )
})

// W2-D, B3: a region is a function of the stack in efforge.jsonc, never of untracked files
const b3: Array<[string, StackConfig, string[]]> = [
  ["default", pg, ["realtime"]],
  ["Alchemy", house, ["browser"]],
  ["Alchemy + d1", { ...d1, infra: "alchemy", extras: [] }, ["email"]],
]
for (const [name, config, add] of b3)
  it(`${name}: add writes the same README whether or not .dev.vars, .env or node_modules exist`, async () => {
    const start = { ...config, extras: config.extras.filter((e) => !add.includes(e)) }
    const results: string[] = []
    for (const variant of ["as created", "fresh clone", "installed"] as const) {
      rmSync(dir, { recursive: true, force: true })
      await run(writeTree(dir, await generated(start)))
      if (variant === "fresh clone")
        for (const f of [".dev.vars", ".env"]) rmSync(join(dir, f), { force: true })
      if (variant === "installed") {
        mkdirSync(join(dir, "node_modules", ".pnpm"), { recursive: true })
        writeFileSync(join(dir, ".dev.vars"), "EXTRA=1\n")
        writeFileSync(join(dir, ".env"), "OTHER=2\n")
      }
      await run(addAddons(dir, add, opts))
      results.push(readme())
    }
    expect(results[1]).toBe(results[0])
    expect(results[2]).toBe(results[0])
    const stack = JSON.parse(
      readFileSync(join(dir, "efforge.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""),
    ).stack as StackConfig
    expect(stack.extras).toEqual(expect.arrayContaining([...add]))
    const fresh = (await generated(stack)).get("README.md") as string
    expect(results[0]).toBe(fresh)
  }, 30_000)

it("Add more suggests an add-on the project lacks, and none when it has them all", async () => {
  const more = async (c: StackConfig) =>
    region((await generated(c)).get("README.md") as string, "more")
  expect(await more(minimal)).toContain("npx -y create-efforge add email")
  const withEmail = await more({ ...pg, extras: ["email"] })
  expect(withEmail).not.toContain("add email")
  expect(withEmail).toContain("npx -y create-efforge add storage")
  const all = await more(house)
  expect(all).toContain("npx -y create-efforge list")
  expect(all).not.toContain("npx -y create-efforge add")
})

// W2-D review S3, S4: AGENTS.md sections follow the stack in a fixed order, stale ones go
for (const [name, start, add] of [
  ["default + email, then Alchemy", { ...pg, extras: ["email"] }, ["infra/alchemy"]],
  ["D1 + Drizzle, then Alchemy", { ...d1, orm: "drizzle", extras: [] }, ["infra/alchemy"]],
  ["minimal, then D1, Drizzle and email", minimal, ["database/d1", "orm/drizzle", "email"]],
] as const)
  it(`AGENTS.md after add (${name}) is what create writes, and the user's text stays`, async () => {
    await run(writeTree(dir, await generated(start)))
    const path = join(dir, "AGENTS.md")
    const mine = readFileSync(path, "utf8")
      .replace("## Commands\n", "## Commands\n\nOur note on commands.\n")
      .replace(
        "<!-- efforge:agents -->",
        "## Our rules\n\nAsk before deploying.\n\n<!-- efforge:agents -->",
      )
    writeFileSync(path, mine)
    await run(addAddons(dir, [...add], opts))
    const after = readFileSync(path, "utf8")
    expect(after).toContain("## Commands\n\nOur note on commands.\n")
    // new sections go above the footer, so after the user's text there
    expect(after).toContain("## Our rules\n\nAsk before deploying.\n\n")
    const stack = JSON.parse(
      readFileSync(join(dir, "efforge.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""),
    ).stack as StackConfig
    const fresh = (await generated(stack)).get("AGENTS.md") as string
    const unmine = after
      .replace("\nOur note on commands.\n", "")
      .replace("## Our rules\n\nAsk before deploying.\n\n", "")
    expect(unmine).toBe(fresh)
    if (stack.infra === "alchemy") {
      expect(after).not.toContain("declared in `wrangler.jsonc`")
      expect(after).not.toContain("declared under `d1_databases` in `wrangler.jsonc`")
      // on D1 alchemy dev migrates; db:migrate needs a wrangler.jsonc
      if (stack.database === "d1") expect(after).not.toMatch(/then `pnpm db:migrate`/)
    }
  }, 30_000)
