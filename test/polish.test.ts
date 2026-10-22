import { stripVTControlCharacters } from "node:util"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { afterEach, beforeEach, expect, it, vi } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { loadAddons } from "../src/addon.ts"
import { runWith } from "../src/cli.ts"
import { addAddons } from "../src/commands/add.ts"
import { isOccupied, nextSteps, TemplatesDir } from "../src/commands/create.ts"
import { listAddons } from "../src/commands/list.ts"
import { generate } from "../src/generate.ts"
import { CANCEL, scriptedPromptIO } from "../src/prompts/navigable.ts"
import { whyUnavailable } from "../src/slots.ts"
import { withDefaults } from "../src/stack.ts"
import { writeTree } from "../src/write.ts"

const fixtures = new URL("./fixtures/templates", import.meta.url).pathname
const env = Layer.mergeAll(NodeServices.layer, Layer.succeed(TemplatesDir, fixtures))
// strips colour so assertions read like the terminal
const plain = (s: string) => stripVTControlCharacters(s)

let cwd: string
let tmp: string
let errors: string[]
beforeEach(() => {
  cwd = process.cwd()
  tmp = mkdtempSync(join(tmpdir(), "efforge-polish-"))
  process.chdir(tmp)
  errors = []
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.join(" ")))
  vi.spyOn(console, "log").mockImplementation(() => {})
  process.exitCode = undefined
})
afterEach(() => {
  vi.restoreAllMocks()
  process.chdir(cwd)
  rmSync(tmp, { recursive: true, force: true })
  process.exitCode = undefined
})

const cli = (args: string[], answers: Parameters<typeof scriptedPromptIO>[0] = []) => {
  const s = scriptedPromptIO(answers)
  return runWith(args)
    .pipe(Effect.provide(Layer.mergeAll(env, s.layer)), Effect.runPromise)
    .then(() => s)
}

it("incompatible flags say why, unknown values say unknown", async () => {
  await cli(["app", "-y", "--dry-run", "--database=none", "--orm=drizzle"])
  expect(plain(errors.join("\n"))).toContain(
    "--orm=drizzle can't be used here: an ORM needs a database, and the database is none",
  )
  errors.length = 0
  await cli(["app", "-y", "--dry-run", "--database=mysql"])
  expect(plain(errors.join("\n"))).toContain(
    "Unknown --database=mysql. Options: postgres, d1, none",
  )
})

it("whyUnavailable explains each rule", () => {
  expect(whyUnavailable("auth", "better-auth", { database: "none" })).toContain("database is none")
  expect(whyUnavailable("orm", "none", { database: "d1" })).toContain("needs an ORM")
  expect(whyUnavailable("orm", "drizzle", { database: "d1" })).toBeUndefined()
  expect(whyUnavailable("database", "mysql", {})).toBeUndefined()
})

it("cancelling exits 130 and writes nothing", async () => {
  const s = await cli(["--no-install", "--no-git"], [CANCEL])
  expect(process.exitCode).toBe(130)
  expect(s.output.at(-1)).toContain("Cancelled")
  expect(readdirSync(tmp)).toEqual([])
})

it("--json reports errors as JSON on stdout", async () => {
  const logs: string[] = []
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")))
  await cli(["app", "--json", "--dry-run", "--database=nope"])
  expect(JSON.parse(logs.join("\n")).error.code).toBe("IncompatibleStack")
  expect(process.exitCode).toBe(1)
})

it("duplicate extras are dropped", async () => {
  const logs: string[] = []
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")))
  await cli(["app", "--json", "--dry-run", "--auth=none", "--extras=email,email"])
  expect(JSON.parse(logs.join("\n")).stack.extras).toEqual(["email"])
})

it("`.` scaffolds into the current directory, named after it", async () => {
  const here = join(tmp, "my-site")
  mkdirSync(join(here, ".git"), { recursive: true })
  process.chdir(here)
  const s = await cli([".", "-y", "--no-install", "--no-git", "--auth=none"])
  expect(readdirSync(here)).toContain("efforge.jsonc")
  const steps = s.output.find((o) => o.startsWith("note Next steps:")) ?? ""
  expect(steps).not.toContain("cd ")
})

it("a directory with only .git counts as empty", () => {
  const d = join(tmp, "repo")
  mkdirSync(join(d, ".git"), { recursive: true })
  expect(isOccupied(d)).toBe(false)
  writeFileSync(join(d, "x"), "")
  expect(isOccupied(d)).toBe(true)
  expect(isOccupied(join(tmp, "missing"))).toBe(false)
})

it("the name prompt rejects an occupied directory and asks again", async () => {
  mkdirSync(join(tmp, "taken"))
  writeFileSync(join(tmp, "taken", "f"), "")
  const s = await cli(
    ["--no-install", "--no-git", "--dry-run"],
    ["taken", "fresh", "postgres", "drizzle", "none", "none", "none", []],
  )
  // dry-run skips the occupied check: run for real to see it
  expect(s.output.some((o) => o.startsWith("invalid name"))).toBe(false)
  const real = await cli(
    ["--no-install", "--no-git"],
    ["taken", "fresh", "postgres", "drizzle", "none", "none", "none", [], false],
  )
  expect(
    real.output.some((o) => o.startsWith("invalid name:") && o.includes("already exists")),
  ).toBe(true)
  expect(real.shown.filter((x) => x.id === "name")).toHaveLength(2)
})

it("next steps follow the stack", () => {
  const steps = (o: Partial<Parameters<typeof withDefaults>[0]>) =>
    plain(
      nextSteps(withDefaults({ name: "app", ...o }), {
        dirName: "app",
        inPlace: false,
        installed: true,
      }),
    )
  const pg = steps({ database: "postgres" })
  expect(pg).toContain("docker compose up -d --wait")
  expect(pg.indexOf("docker")).toBeLessThan(pg.indexOf("pnpm db:migrate"))
  expect(pg.indexOf("pnpm db:migrate")).toBeLessThan(pg.indexOf("pnpm dev"))
  const d1 = steps({ database: "d1", orm: "effect-sql" })
  expect(d1).toContain("pnpm db:migrate")
  expect(d1).not.toContain("docker")
  const none = steps({ database: "none", orm: "none", auth: "none" })
  expect(none).not.toContain("db:migrate")
  expect(steps({ infra: "alchemy" })).toContain("cp .env.example .env")
})

const noDbProject = () =>
  Effect.gen(function* () {
    const dir = join(tmp, "nodb")
    const tree = yield* generate(
      withDefaults({ name: "nodb", database: "none", orm: "none", auth: "none" }),
      yield* loadAddons(fixtures),
    )
    yield* writeTree(dir, tree)
    return dir
  })

it.effect("add: auth or ORM without a database says to add them together", () =>
  Effect.gen(function* () {
    const dir = yield* noDbProject()
    const e = yield* addAddons(dir, ["orm/drizzle"], { overwrite: false, dryRun: true }).pipe(
      Effect.flip,
    )
    expect(e._tag).toBe("IncompatibleStack")
    expect((e as { reason?: string }).reason).toContain("efforge add database/d1 orm/drizzle")
    const db = yield* addAddons(dir, ["database/d1"], { overwrite: false, dryRun: true }).pipe(
      Effect.flip,
    )
    expect((db as { reason?: string }).reason).toContain("orm/drizzle")
  }).pipe(Effect.provide(env)),
)

it.effect("add: unknown ids get a did-you-mean, ids are case-insensitive", () =>
  Effect.gen(function* () {
    const dir = yield* noDbProject()
    const e = yield* addAddons(dir, ["emial"], { overwrite: false, dryRun: true }).pipe(Effect.flip)
    expect(e._tag).toBe("UnknownAddon")
    expect((e as { message?: string }).message).toContain("Did you mean email?")
    const ok = yield* addAddons(dir, ["Email"], { overwrite: false, dryRun: true })
    expect(ok.added.map((a) => a.id)).toEqual(["extras/email"])
  }).pipe(Effect.provide(env)),
)

it.effect("list marks what the project already has", () =>
  Effect.gen(function* () {
    const dir = yield* noDbProject()
    const outside = yield* listAddons(tmp)
    expect(outside.project).toBe(false)
    expect(outside.addons.map((a) => a.id)).toContain("extras/email")
    expect(outside.addons.some((a) => a.id.endsWith("/none"))).toBe(false)
    const inside = yield* listAddons(dir)
    expect(inside.project).toBe(true)
    expect(inside.addons.find((a) => a.id === "extras/email")?.installed).toBe(false)
  }).pipe(Effect.provide(env)),
)
