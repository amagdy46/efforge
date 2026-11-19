import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { stripVTControlCharacters } from "node:util"
import { NodeServices } from "@effect/platform-node"
import { afterAll, afterEach, beforeEach, expect, it, vi } from "@effect/vitest"
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
    "npx -y create-efforge --help",
    "npx -y create-efforge zz --yes --database=d1 --json",
  ],
  [
    ["add", "email", "--jsn", "--json"],
    "--json",
    "npx -y create-efforge add --help",
    "npx -y create-efforge add email --json",
  ],
  [
    ["list", "--jsonn", "--json"],
    "--json",
    "npx -y create-efforge list --help",
    "npx -y create-efforge list --json",
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
  expect(err.replaceAll("\n", " ")).toContain(message)
  expect(err.replaceAll("\n", " ")).toContain("--help to see every flag")
  expect(err).toContain("Try: npx -y create-efforge ")
  expect(err).not.toContain("USAGE")
  expect(err.split("\n").length).toBeLessThanOrEqual(3)
})

it("--json: an invalid value for a global flag is one JSON error too, not a log line", async () => {
  await cli(["zz", "--yes", "--dry-run", "--json", "--log-level=nope"])
  expect(process.exitCode).toBe(1)
  expect(stderr).toEqual([])
  const out = JSON.parse(stdout.join("\n"))
  expect(out.error.code).toBe("InvalidFlagValue")
  // which level was meant is the caller's choice: no fix, the levels as data
  expect(out.error.fix).toBeNull()
  expect(out.error.allowed).toContain("debug")
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

// The library's built-in flags, run as an agent runs them: no terminal (stdin closed) and CI=1.
// None may prompt or hang; --wizard (which prompted and exited 0) isn't one of efforge's flags.
const bin = new URL("../src/bin.ts", import.meta.url).pathname
const empty = mkdtempSync(join(tmpdir(), "efforge-builtins-"))
afterAll(() => rmSync(empty, { recursive: true, force: true }))
const run = (args: string[]) => {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd: empty,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "1" },
    encoding: "utf8",
    timeout: 20_000,
  })
  return { code: r.status, out: r.stdout, err: stripVTControlCharacters(r.stderr) }
}

it.each([
  [["--wizard"]],
  [["add", "--wizard"]],
  [["--wizard", "--json"]],
  [["list", "--wizard", "--json"]],
])("without a terminal, %j is an unknown flag, not a prompt", { timeout: 30_000 }, (args) => {
  const r = run(args)
  expect(r.code).toBe(1)
  expect(r.out + r.err).not.toContain("Wizard")
  if (args.includes("--json")) {
    const doc = JSON.parse(r.out)
    expect(doc.error).toMatchObject({ code: "UnknownFlag", flag: "--wizard", fix: null })
    expect(r.err).toBe("")
  } else expect(r.err).toContain("Unknown flag --wizard.")
})

it.each([
  [["--help"], "USAGE"],
  [["--help", "--json"], "USAGE"],
  [["-h"], "USAGE"],
  [["--version"], "create-efforge v"],
  [["--completions", "bash"], "complete -F"],
  [["--completions", "zsh", "--json"], "#compdef"],
])("without a terminal, %j prints text and exits 0", { timeout: 30_000 }, (args, text) => {
  const r = run(args)
  expect(r.code).toBe(0)
  expect(r.out).toContain(text)
  expect(r.out).not.toContain("--wizard")
})

it.each([[["--version", "--json"]], [["-v", "--json"]]])(
  "%j prints the envelope alone",
  { timeout: 30_000 },
  (args) => {
    const r = run(args)
    expect(r.code).toBe(0)
    expect(Object.keys(JSON.parse(r.out))).toEqual(["efforge", "contract", "ok"])
  },
)

it("--log-level is accepted and changes nothing efforge prints", { timeout: 30_000 }, () => {
  const a = run(["list", "--json"])
  const b = run(["list", "--json", "--log-level=all"])
  expect(b.code).toBe(0)
  expect(b.err).toBe("")
  expect(JSON.parse(b.out)).toEqual(JSON.parse(a.out))
})

// Errors on stderr wrap like prompts and ordinary output: 80 columns, never inside a command or a
// path, and nothing lost (the lines, joined, are the --json message).
it.each([
  [["lst"]],
  [["zz", "--databse=d1"]],
  [["add"]],
  [["add", "email", "--cwd", "nowhere/at/all"]],
  [["zz", "--auth=better-auth", "--database=none"]],
  [["info", "stripe"]],
])("%j: the error on stderr fits 80 columns, commands whole", { timeout: 60_000 }, (args) => {
  const text = run(args)
  const doc = JSON.parse(run([...args, "--json"]).out)
  const lines = text.err.split("\n").filter((l) => !/^[┌│└]/.test(l))
  // the same error; a command it names keeps the caller's flags, so --json is in that one
  const message: string = doc.error.message.replaceAll(" --json", "")
  const end = lines.findIndex((l) => l === "" || l.startsWith("Try: "))
  const body = end < 0 ? lines : lines.slice(0, end)
  expect(body.join(" ")).toBe(message)
  for (const l of body) expect(l.length, l).toBeLessThanOrEqual(80)
  // each command the message names is on one line
  for (const m of message.matchAll(/npx -y create-efforge[^.,;]*/g))
    expect(
      body.some((l) => l.includes(m[0].trim())),
      m[0],
    ).toBe(true)
})
