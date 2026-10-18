import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { afterEach, beforeEach, expect, it, vi } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { runWith } from "../src/cli.ts"
import { TemplatesDir } from "../src/commands/create.ts"
import { type Answer, scriptedPromptIO } from "../src/prompts/navigable.ts"
import { ROUTE_TREE_COMMAND } from "../src/routeTree.ts"
import { TargetNotEmpty, writeTree } from "../src/write.ts"
import { recordingSpawner } from "./recordingSpawner.ts"

const fixtures = new URL("./fixtures/templates", import.meta.url).pathname
let cwd: string
let tmp: string
let logs: string[]

beforeEach(() => {
  cwd = process.cwd()
  tmp = mkdtempSync(join(tmpdir(), "efforge-create-"))
  process.chdir(tmp)
  logs = []
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")))
  process.exitCode = undefined
})
afterEach(() => {
  vi.restoreAllMocks()
  process.chdir(cwd)
  rmSync(tmp, { recursive: true, force: true })
  process.exitCode = undefined
})

const cli = (args: string[], answers: ReadonlyArray<Answer> = []) => {
  const s = scriptedPromptIO(answers)
  const p = runWith(args).pipe(
    Effect.provide(
      Layer.mergeAll(NodeServices.layer, s.layer, Layer.succeed(TemplatesDir, fixtures)),
    ),
    Effect.runPromise,
  )
  return { s, p }
}

// the fixture templates cover postgres/d1, drizzle and the email extra only
const stackFlags = ["--auth=none", "--infra=none", "--ai=none"]

it("dry-run --json prints valid JSON {stack, command, files} and writes nothing", async () => {
  await cli(["app", "--dry-run", "--json", ...stackFlags, "--extras=email"]).p
  const out = JSON.parse(logs.join("\n"))
  expect(Object.keys(out).toSorted()).toEqual(["command", "files", "stack"])
  expect(out.stack).toMatchObject({
    name: "app",
    database: "postgres",
    orm: "drizzle",
    extras: ["email"],
  })
  expect(out.command).toBe("npm create efforge app -- --yes --auth=none --extras=email")
  expect(out.files).toContain("efforge.jsonc")
  expect(readdirSync(tmp)).toEqual([])
})

it("the printed command replays the stack without prompting", async () => {
  await cli(["app", "--dry-run", "--json", ...stackFlags, "--extras=email"]).p
  const { command, stack } = JSON.parse(logs.join("\n"))
  logs = []
  const args = command
    .replace(/^npm create efforge /, "")
    .replace(" -- ", " ")
    .split(" ")
  // no --json here: it implies --yes and would hide a missing one
  const { s, p } = cli([...args, "--dry-run"])
  await p
  expect(s.shown).toEqual([])
  expect(stack.extras).toEqual(["email"])
})

it("dry-run without json lists the paths and writes nothing", async () => {
  await cli(["app", "--dry-run", "-y", ...stackFlags]).p
  expect(logs.join("\n")).toContain("efforge.jsonc")
  expect(readdirSync(tmp)).toEqual([])
})

it("writes the project with -y --no-install --no-git", async () => {
  const { s, p } = cli(["app", "-y", "--no-install", "--no-git", ...stackFlags])
  await p
  expect(s.shown).toEqual([])
  expect(existsSync(join(tmp, "app", "efforge.jsonc"))).toBe(true)
  expect(existsSync(join(tmp, "app", ".git"))).toBe(false)
  expect(
    s.output.some(
      (o) => o.startsWith("outro:") && o.includes("cd app") && o.includes("npm create efforge app"),
    ),
  ).toBe(true)
})

it("--install=false and --git=false are accepted too", async () => {
  await cli(["app", "-y", "--install=false", "--git=false", ...stackFlags]).p
  expect(existsSync(join(tmp, "app", "efforge.jsonc"))).toBe(true)
})

it("interactive: answers drive the stack and confirm gates writing", async () => {
  const { s, p } = cli(
    ["--no-install", "--no-git"],
    ["app", "postgres", "drizzle", "none", "none", "none", [], true],
  )
  await p
  expect(s.shown.map((x) => x.id)).toEqual([
    "name",
    "database",
    "orm",
    "auth",
    "infra",
    "ai",
    "extras",
    "confirm",
  ])
  expect(existsSync(join(tmp, "app", "efforge.jsonc"))).toBe(true)
})

it("declining the confirmation writes nothing", async () => {
  const { p } = cli(
    ["--no-install", "--no-git"],
    ["app", "postgres", "drizzle", "none", "none", "none", [], false],
  )
  await p
  expect(readdirSync(tmp)).toEqual([])
})

it("incompatible flags fail with exit code 1 and write nothing", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {})
  await cli(["app", "-y", "--database=none", "--auth=better-auth"]).p
  expect(process.exitCode).toBe(1)
  expect(String(err.mock.calls[0]?.[0])).toContain("Options: none")
  expect(readdirSync(tmp)).toEqual([])
})

it("an existing non-empty target is refused", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {})
  await cli(["app", "-y", "--no-install", "--no-git", ...stackFlags]).p
  writeFileSync(join(tmp, "app", "mine.txt"), "keep")
  process.exitCode = undefined
  await cli(["app", "-y", "--no-install", "--no-git", ...stackFlags]).p
  expect(process.exitCode).toBe(1)
  expect(String(err.mock.calls.at(-1)?.[0])).toContain("not empty")
  expect(readFileSync(join(tmp, "app", "mine.txt"), "utf8")).toBe("keep")
})

it("git init + add + commit runs (commit may be skipped without a configured identity)", async () => {
  await cli(["app", "-y", "--no-install", ...stackFlags]).p
  expect(existsSync(join(tmp, "app", ".git"))).toBe(true)
})

it("add is registered and reports a directory that is not an efforge project", async () => {
  const errors: string[] = []
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.join(" ")))
  await cli(["add", "email", "--no-install"]).p
  expect(errors.join("\n")).toContain("not an efforge project")
  expect(process.exitCode).toBe(1)
})

it.effect("writeTree fails with TargetNotEmpty on a non-empty dir, accepts an empty one", () =>
  Effect.gen(function* () {
    const dir = join(tmp, "x")
    yield* writeTree(dir, new Map([["a/b.txt", "hi"]]))
    expect(readFileSync(join(dir, "a/b.txt"), "utf8")).toBe("hi")
    const err = yield* writeTree(dir, new Map([["c.txt", "no"]])).pipe(Effect.flip)
    expect(err).toBeInstanceOf(TargetNotEmpty)
    expect(existsSync(join(dir, "c.txt"))).toBe(false)
  }).pipe(Effect.provide(NodeServices.layer)),
)

it("a non-empty target is refused before the confirm prompt", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  mkdirSync(join(tmp, "app"))
  writeFileSync(join(tmp, "app", "mine.txt"), "keep")
  const { s, p } = cli(
    ["--no-install", "--no-git"],
    ["app", "postgres", "drizzle", "none", "none", "none", []],
  )
  await p
  expect(process.exitCode).toBe(1)
  expect(s.shown.map((x) => x.id)).not.toContain("confirm")
})

it("--json without --dry-run keeps stdout JSON-only and writes the project", async () => {
  const { s, p } = cli(["app", "--json", "--no-install", "--no-git", ...stackFlags])
  await p
  expect(s.output).toEqual([])
  expect(Object.keys(JSON.parse(logs.join("\n"))).toSorted()).toEqual(["command", "files", "stack"])
  expect(existsSync(join(tmp, "app", "efforge.jsonc"))).toBe(true)
})

const runRecorded = (args: string[]) => {
  const calls: string[] = []
  const s = scriptedPromptIO([])
  return runWith(args)
    .pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          s.layer,
          Layer.succeed(TemplatesDir, fixtures),
          recordingSpawner(calls),
        ),
      ),
      Effect.runPromise,
    )
    .then(() => calls)
}

it("git init runs before pnpm format, and the commit comes after it", async () => {
  const calls = await runRecorded(["app", "-y", ...stackFlags])
  expect(calls).toEqual([
    "git init",
    "pnpm install",
    ROUTE_TREE_COMMAND,
    "pnpm format",
    "git add -A",
    "git commit -m Initial commit from efforge",
  ])
})

it("without git, format names the files so a parent repo's ignore rules cannot hide them", async () => {
  const calls = await runRecorded(["app", "-y", "--no-git", ...stackFlags])
  expect(calls.map((c) => c.split(" ").slice(0, 2).join(" "))).toEqual([
    "pnpm install",
    "pnpm --filter",
    "pnpm format",
  ])
  expect(calls[2]).toContain("package.json")
})
