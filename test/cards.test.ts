import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { afterEach, beforeEach, expect, it } from "@effect/vitest"
import { Effect, type Layer } from "effect"
import { type LoadedAddon, loadAddons } from "../src/addon.ts"
import { CARDS_DIR, REGISTRY_FILE, SERVER_DIR } from "../src/cards.ts"
import { addAddons } from "../src/commands/add.ts"
import { generate } from "../src/generate.ts"
import { validate } from "../src/rules.ts"
import { slots } from "../src/slots.ts"
import { type StackConfig, withDefaults } from "../src/stack.ts"
import type { Tree } from "../src/tree.ts"
import { writeTree } from "../src/write.ts"

// A card's files and the transforms on them are one unit (docs/capability-cards.md): on an auth
// stack every server function a card calls requires a session, whichever add-on came first, and a
// project without the card registry gets the add-on without any of it.

const templates = new URL("../templates", import.meta.url).pathname

const run = <A, E>(eff: Effect.Effect<A, E, Layer.Success<typeof NodeServices.layer>>) =>
  Effect.runPromise(eff.pipe(Effect.provide(NodeServices.layer)))

const AUTHS = (slots.find((s) => s.id === "auth")?.options ?? [])
  .map((o) => o.id)
  .filter((id) => id !== "none")

/**
 * The `createServerFn(...)` calls in `source` whose chain has no `.middleware([requireSession])`,
 * as the text that starts each one.
 */
const unguarded = (source: string): string[] => {
  const out: string[] = []
  for (const m of source.matchAll(/createServerFn\(/g)) {
    // the chain runs to the end of the statement: the next blank line, or the end of the file
    const rest = source.slice(m.index)
    const chain = rest.slice(0, rest.search(/\n\s*\n|$/))
    if (!/\.middleware\(\[[^\]]*\brequireSession\b/.test(chain))
      out.push(chain.split("\n").slice(0, 2).join(" "))
  }
  return out
}

/** Every server function in a card file under apps/web/src/server/ of `tree`, unguarded or not. */
const cardServerFiles = (addons: ReadonlyMap<string, LoadedAddon>, tree: Tree) =>
  [...addons.values()]
    .flatMap(({ manifest }) => manifest.card?.files ?? [])
    .map((f) => f.target)
    .filter((t, i, all) => t.startsWith(SERVER_DIR) && all.indexOf(t) === i && tree.has(t))

/** A stack that has the add-on `id`, with auth `auth`. */
const stackWith = (id: string, auth: string): StackConfig => {
  const [slot, option] = id.split("/") as [string, string | undefined]
  const config: Record<string, unknown> = {
    name: "app",
    database: "d1",
    orm: "effect-sql",
    auth,
    infra: "none",
    ai: "none",
    extras: [],
  }
  if (slot === "extras") config.extras = [option]
  else if (option !== undefined) config[slot] = option
  if (slot === "database" && config.orm === "none") config.orm = "effect-sql"
  return withDefaults(config as never)
}

it("on an auth stack, every server function in every card's files requires a session", async () => {
  const addons = await run(loadAddons(templates))
  const carded = [...addons.values()].filter((a) => a.manifest.card !== undefined)
  // the runtime, database, auth and realtime cards today; a new card is checked without a change here
  expect(carded.map((a) => a.manifest.id)).toEqual(
    expect.arrayContaining([
      "base",
      "orm/drizzle",
      "orm/effect-sql",
      "auth/better-auth",
      "extras/realtime",
    ]),
  )
  let files = 0
  for (const { manifest } of carded)
    for (const auth of AUTHS) {
      const config = stackWith(manifest.id, auth)
      const valid = await Effect.runPromise(Effect.result(validate(config)))
      if (valid._tag === "Failure") continue
      const tree = await run(generate(config, addons))
      for (const file of cardServerFiles(addons, tree)) {
        expect(unguarded(tree.get(file) ?? ""), `${manifest.id} with ${auth}: ${file}`).toEqual([])
        expect(tree.get(file), file).toContain('import { requireSession } from "./require-session"')
        files++
      }
    }
  expect(files).toBeGreaterThanOrEqual(10)
})

it("without auth, card server functions carry no session guard", async () => {
  const addons = await run(loadAddons(templates))
  const tree = await run(
    generate(
      withDefaults({
        name: "app",
        database: "d1",
        orm: "drizzle",
        auth: "none",
        infra: "none",
        ai: "none",
        extras: ["realtime"],
      }),
      addons,
    ),
  )
  for (const file of [
    "apps/web/src/server/notes.ts",
    "apps/web/src/server/realtime-demo.ts",
    "apps/web/src/server/greeting.ts",
  ])
    expect(tree.get(file), file).not.toContain("requireSession")
})

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "efforge-cards-"))
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const opts = { overwrite: false, dryRun: false, install: false }

/** Generates `config` into `<tmp>/app`, lets `prepare` change it, then adds `ids`. */
const addLater = (
  config: StackConfig,
  ids: string[],
  prepare: (dir: string) => void = () => {},
) => {
  const dir = join(tmp, "app")
  return run(
    Effect.gen(function* () {
      yield* writeTree(dir, yield* generate(config, yield* loadAddons(templates)))
      prepare(dir)
      return { dir, result: yield* addAddons(dir, ids, opts) }
    }),
  )
}

const d1 = (auth: string, extras: string[] = []) =>
  withDefaults({
    name: "app",
    database: "d1",
    orm: "effect-sql",
    auth,
    infra: "none",
    ai: "none",
    extras,
  } as never)

it("auth added later adds the guard to an existing middleware list, and names one it cannot edit", async () => {
  const notes = "apps/web/src/server/notes.ts"
  const { dir, result } = await addLater(d1("none"), ["auth/better-auth"], (d) => {
    const file = join(d, notes)
    writeFileSync(
      file,
      readFileSync(file, "utf8")
        .replace(
          'createServerFn({ method: "GET" }).handler(',
          'createServerFn({ method: "GET" }).middleware([timing]).handler(',
        )
        .replace(
          'createServerFn({ method: "POST" })\n',
          'createServerFn({ method: "POST" })\n  .middleware(shared)\n',
        ),
    )
  })
  const text = readFileSync(join(dir, notes), "utf8")
  // a list efforge can edit gets requireSession first; nothing passes silently
  expect(text).toContain(".middleware([requireSession, timing])")
  expect(text).toContain(".middleware(shared)")
  expect(result.notes).toEqual([
    expect.stringMatching(
      /^addNote in apps\/web\/src\/server\/notes\.ts is not guarded: .*\.middleware\(\[requireSession, \.\.\.\]\).*pnpm check fails/,
    ),
  ])
})

it("auth added to a realtime project from before the socket check goes on, with a note on the room", async () => {
  const route = "apps/web/src/server/realtime-route.ts"
  const { dir, result } = await addLater(d1("none", ["realtime"]), ["auth/better-auth"], (d) =>
    // the route as efforge wrote it before upgradeGuards existed
    writeFileSync(
      join(d, route),
      readFileSync(join(d, route), "utf8").replaceAll("upgradeGuards", "checks"),
    ),
  )
  expect(readFileSync(join(dir, route), "utf8")).not.toContain("requireSocketSession")
  expect(result.notes).toEqual([
    expect.stringMatching(
      /^apps\/web\/src\/server\/realtime-route\.ts has no upgradeGuards list .*requireSocketSession/,
    ),
  ])
})

it("auth added after realtime puts the session check on the room's upgrade", async () => {
  const { dir, result } = await addLater(d1("none", ["realtime"]), ["auth/better-auth"])
  const route = readFileSync(join(dir, "apps/web/src/server/realtime-route.ts"), "utf8")
  expect(route).toContain('import { requireSocketSession } from "./socket-session"')
  expect(route).toMatch(/upgradeGuards: ReadonlyArray<WorkerRoute> = \[[^\]]*requireSocketSession/)
  expect(result.notes).toEqual([])
})

it("auth added after the cards guards their server functions too", async () => {
  const { dir, result } = await addLater(d1("none", ["realtime"]), ["auth/better-auth"])
  const addons = await run(loadAddons(templates))
  const read = (f: string) => readFileSync(join(dir, f), "utf8")
  const files = [
    "apps/web/src/server/greeting.ts",
    "apps/web/src/server/notes.ts",
    "apps/web/src/server/realtime-demo.ts",
    "apps/web/src/server/account.ts",
  ]
  for (const file of files) expect(unguarded(read(file)), file).toEqual([])
  // the same files, guarded the same way, as a project created with auth from the start
  const fresh = await run(generate(d1("better-auth", ["realtime"]), addons))
  for (const file of files) expect(read(file), file).toBe(fresh.get(file))
  expect(result.notes).toEqual([])
})

it("a card added after auth is guarded", async () => {
  const { dir } = await addLater(d1("better-auth"), ["realtime"])
  expect(
    unguarded(readFileSync(join(dir, "apps/web/src/server/realtime-demo.ts"), "utf8")),
  ).toEqual([])
})

/**
 * The base files efforge 0.3 added, which a project from 0.2.x does not have (the card registry
 * among them), and every card's own files.
 */
const BEFORE_CARDS = [
  ".nvmrc",
  "apps/web/public/favicon.svg",
  "apps/web/src/capabilities/registry.ts",
  "apps/web/src/capabilities/runtime.tsx",
  "apps/web/src/capabilities/types.ts",
  "apps/web/src/components/app-shell.tsx",
  "apps/web/src/components/capability-card.tsx",
  "apps/web/src/components/code-block.tsx",
  "apps/web/src/components/demo.tsx",
  "apps/web/src/components/layer-graph.tsx",
  "apps/web/src/lib/highlight.ts",
  "apps/web/src/lib/layer-graph.ts",
  "apps/web/src/lib/project.ts",
  "apps/web/src/lib/snippet.ts",
  "apps/web/src/lib/stack.ts",
  "apps/web/src/lib/use-server-call.ts",
  "apps/web/src/server/outcome.ts",
  "apps/web/src/server/stack.ts",
  "packages/core/src/greeting.ts",
  "packages/core/test/greeting.test.ts",
  `${CARDS_DIR}database.tsx`,
  `${CARDS_DIR}auth.tsx`,
  "apps/web/src/server/notes.ts",
  "apps/web/src/server/account.ts",
]
const beforeCards = (dir: string) => {
  for (const f of BEFORE_CARDS) rmSync(join(dir, f), { force: true })
}

it("a project from before cards gets a guarded card's add-on without the card, and one note", async () => {
  const { dir, result } = await addLater(d1("better-auth"), ["realtime"], beforeCards)
  expect(existsSync(join(dir, "packages/core/src/realtime.ts"))).toBe(true)
  expect(readFileSync(join(dir, "apps/web/src/server/layers.ts"), "utf8")).toContain("RealtimeLive")
  for (const f of [
    `${CARDS_DIR}realtime.tsx`,
    "apps/web/src/server/realtime-demo.ts",
    REGISTRY_FILE,
  ])
    expect(existsSync(join(dir, f)), f).toBe(false)
  expect(result.written).not.toContain(REGISTRY_FILE)
  expect(result.notes).toHaveLength(1)
  expect(result.notes[0]).toMatch(
    /^No dashboard card for Realtime: .*registry\.ts.*nothing to do\.$/,
  )
})

it("auth added to a project from before cards leaves its existing server functions alone", async () => {
  const { dir, result } = await addLater(d1("none", ["realtime"]), ["auth/better-auth"], (d) => {
    beforeCards(d)
    rmSync(join(d, `${CARDS_DIR}realtime.tsx`))
    rmSync(join(d, "apps/web/src/server/realtime-demo.ts"))
  })
  // greeting.ts was there in 0.2.x, without the card; it is not the card's to guard there
  expect(readFileSync(join(dir, "apps/web/src/server/greeting.ts"), "utf8")).not.toContain(
    "requireSession",
  )
  expect(existsSync(join(dir, "apps/web/src/server/account.ts"))).toBe(false)
  expect(result.notes).toEqual([expect.stringMatching(/^No dashboard card for Better Auth: /)])
})

/** A templates dir with a base and one add-on whose card is `card`, plus `files` on disk. */
const templatesWith = (card: unknown, files: Record<string, string>) => {
  const root = join(tmp, "templates")
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
  const manifest = (id: string, extra: object) => ({
    id,
    title: id,
    description: "",
    files: [],
    dependencies: {},
    devDependencies: {},
    envVars: [],
    requires: [],
    conflicts: [],
    transforms: [],
    ...extra,
  })
  write("base/addon.json", JSON.stringify(manifest("base", {})))
  write("extras/demo/addon.json", JSON.stringify(manifest("extras/demo", { card })))
  for (const [rel, text] of Object.entries(files)) write(`extras/demo/${rel}`, text)
  return root
}

const refusal = (root: string) =>
  run(Effect.flip(loadAddons(root))).then((e) => ({ reason: e.reason, message: e.message }))

const module = { path: "card.tsx", target: `${CARDS_DIR}demo.tsx` }
const serverFn = 'export const ping = createServerFn({ method: "POST" }).handler(() => 1)\n'

it("loadAddons refuses a card that breaks the contract", async () => {
  expect(
    await refusal(
      templatesWith(
        { export: "demo", files: [{ path: "card.tsx", target: "apps/web/src/demo.tsx" }] },
        { "card.tsx": "" },
      ),
    ),
  ).toEqual({ reason: "invalid-card", message: expect.stringContaining("must be under") })
  // a server function outside the card's server files could not be guarded
  expect(
    await refusal(templatesWith({ export: "demo", files: [module] }, { "card.tsx": serverFn })),
  ).toEqual({ reason: "invalid-card", message: expect.stringContaining("calls createServerFn") })
  expect(
    await refusal(
      templatesWith(
        {
          export: "demo",
          files: [module, { path: "util.ts", target: `${SERVER_DIR}demo-util.ts` }],
        },
        { "card.tsx": "", "util.ts": "export const x = 1\n" },
      ),
    ),
  ).toEqual({
    reason: "invalid-card",
    message: expect.stringContaining("without a createServerFn"),
  })
  // a card's transforms edit only the card's own files
  expect(
    await refusal(
      templatesWith(
        {
          export: "demo",
          files: [module],
          transforms: [
            {
              name: "addExport",
              args: { file: "packages/core/src/index.ts", export: "*", from: "./demo" },
            },
          ],
        },
        { "card.tsx": "" },
      ),
    ),
  ).toEqual({
    reason: "invalid-card",
    message: expect.stringContaining("not one of the card's files"),
  })
})

it("loadAddons accepts a card whose transforms edit its own files", async () => {
  const root = templatesWith(
    {
      export: "demo",
      files: [module, { path: "demo.ts", target: `${SERVER_DIR}demo.ts` }],
      transforms: [
        {
          name: "addImport",
          args: { file: `${SERVER_DIR}demo.ts`, import: "Effect", from: "effect" },
        },
      ],
    },
    { "card.tsx": "", "demo.ts": serverFn },
  )
  const addons = await run(loadAddons(root))
  expect(addons.get("extras/demo")?.manifest.card?.transforms).toHaveLength(1)
})

// Base files a user is expected to edit belong to the user: an add-on brings them only to a
// project that lacks them (from before efforge 0.3), and never replaces them.
const PROJECT = "apps/web/src/lib/project.ts"
const SHELL = "apps/web/src/components/app-shell.tsx"

for (const auth of AUTHS)
  it(`${auth} added after the app is renamed and its shell edited keeps both edits`, async () => {
    const { dir, result } = await addLater(d1("none"), [`auth/${auth}`], (d) => {
      const edit = (f: string, from: string, to: string) =>
        writeFileSync(join(d, f), readFileSync(join(d, f), "utf8").replace(from, to))
      edit(PROJECT, 'PROJECT_NAME = "app"', 'PROJECT_NAME = "Rentals"')
      edit(SHELL, `label: "Settings"`, `label: "Preferences"`)
    })
    expect(readFileSync(join(dir, PROJECT), "utf8")).toContain('PROJECT_NAME = "Rentals"')
    expect(readFileSync(join(dir, SHELL), "utf8")).toContain("Preferences")
    expect(result.written).not.toContain(PROJECT)
    expect(result.written).not.toContain(SHELL)
  })

it("auth brings the app shell and the project name to a project from before cards", async () => {
  const { dir, result } = await addLater(d1("none"), ["auth/better-auth"], beforeCards)
  expect(result.created).toEqual(expect.arrayContaining([PROJECT, SHELL]))
  expect(readFileSync(join(dir, PROJECT), "utf8")).toContain('PROJECT_NAME = "app"')
})
