import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { stripVTControlCharacters } from "node:util"
import { NodeServices } from "@effect/platform-node"
import { afterEach, beforeEach, expect, it, vi } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { runWith } from "../src/cli.ts"
import { TemplatesDir } from "../src/commands/create.ts"
import { scriptedPromptIO } from "../src/prompts/navigable.ts"

// A mistyped flag must not dump the help: under --json it is one JSON error on stdout, otherwise
// a short message on stderr that names the closest flag and points to --help.

const fixtures = new URL("./fixtures/templates", import.meta.url).pathname
let stdout: string[]
let stderr: string[]
beforeEach(() => {
  stdout = []
  stderr = []
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void stdout.push(a.join(" ")))
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void stderr.push(a.join(" ")))
  process.exitCode = undefined
})
afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

const cli = (args: string[]) =>
  runWith(args).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        scriptedPromptIO([]).layer,
        Layer.succeed(TemplatesDir, fixtures),
      ),
    ),
    Effect.runPromise,
  )

it.each([
  [
    ["zz", "--yes", "--databse=d1", "--json"],
    "--database",
    "npx create-efforge --help",
    "npx create-efforge zz --yes --database=d1 --json",
  ],
  [
    ["add", "email", "--jsn", "--json"],
    "--json",
    "npx create-efforge add --help",
    "npx create-efforge add email --json",
  ],
  [
    ["list", "--jsonn", "--json"],
    "--json",
    "npx create-efforge list --help",
    "npx create-efforge list --json",
  ],
])("--json: %j prints one JSON error naming the closest flag", async (args, flag, help, fix) => {
  await cli(args)
  expect(process.exitCode).toBe(1)
  expect(stderr).toEqual([])
  const out = JSON.parse(stdout.join("\n"))
  expect(Object.keys(out)).toEqual(["efforge", "contract", "ok", "error"])
  expect(out.ok).toBe(false)
  expect(out.error.code).toBe("UnknownFlag")
  expect(out.error.message).toContain(`Did you mean ${flag}?`)
  expect(out.error.message).toContain(help)
  expect(out.error.fix).toBe(fix)
  expect(out.error.suggestions).toEqual([flag])
})

it.each([
  [["zz", "--yes", "--databse=d1"], "Unknown flag --databse. Did you mean --database?"],
  [["add", "emial", "--dry-rn"], "Unknown flag --dry-rn. Did you mean --dry-run?"],
  [["list", "--jsonn"], "Unknown flag --jsonn. Did you mean --json?"],
])("without --json: %j prints a short error, not the help", async (args, message) => {
  await cli(args)
  expect(process.exitCode).toBe(1)
  expect(stdout).toEqual([])
  const err = stripVTControlCharacters(stderr.join("\n"))
  expect(err).toContain(message)
  expect(err).toContain("--help to see every flag")
  expect(err).toContain("Try: npx create-efforge ")
  expect(err).not.toContain("USAGE")
  expect(err.split("\n").length).toBeLessThanOrEqual(3)
})

it("--json: an invalid value for a global flag is one JSON error too, not a log line", async () => {
  await cli(["zz", "--yes", "--dry-run", "--json", "--log-level=nope"])
  expect(process.exitCode).toBe(1)
  expect(stderr).toEqual([])
  const out = JSON.parse(stdout.join("\n"))
  expect(out.error.code).toBe("InvalidFlagValue")
  expect(out.error.fix).toBe("npx create-efforge zz --yes --dry-run --json")
  expect(out.error.message).toContain("--log-level")
})

it("a valid command still runs, and --help still prints the help", async () => {
  await cli(["list", "--json"])
  expect(process.exitCode).toBeUndefined()
  expect(JSON.parse(stdout.join("\n")).addons.length).toBeGreaterThan(0)
  stdout.length = 0
  await cli(["add", "--help"])
  expect(stdout.join("\n")).toContain("USAGE")
  expect(process.exitCode).toBeUndefined()
})

// "v0.1" went stale the day 0.2.0 shipped: say "yet", or read the version.
it("no user-facing text names a hard-coded version like v0.1", () => {
  const root = new URL("..", import.meta.url).pathname
  const files = ["README.md", "docs/cli.md", "docs/limits.md"]
  const walk = (d: string): string[] =>
    readdirSync(join(root, d), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
    )
  files.push(...walk("src"), ...walk("templates").filter((f) => !f.endsWith("package-lock")))
  for (const f of files) expect(readFileSync(join(root, f), "utf8"), f).not.toMatch(/\bv0\.\d+\b/)
})
