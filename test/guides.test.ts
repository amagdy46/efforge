import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { Completions } from "effect/cli"
import { expect, it, vi } from "vitest"
import { loadAddons } from "../src/addon.ts"
import { root as cliRoot, runWith } from "../src/cli.ts"
import { defaultTemplatesDir } from "../src/commands/create.ts"
import { scriptedPromptIO } from "../src/prompts/navigable.ts"
import { readmeRegions } from "../src/readme.ts"
import { withDefaults } from "../src/stack.ts"
import { recordingSpawner } from "./recordingSpawner.ts"

// README.md, docs/deploy.md, docs/upgrading.md and docs/cli.md are held to the code: every
// efforge command they show runs, the deploy guide's commands are the generated READMEs', and the
// CLI reference names every flag of every command.

const root = new URL("..", import.meta.url).pathname
const read = (p: string) => readFileSync(join(root, p), "utf8")

/** Runs efforge in `cwd` with child processes (pnpm, git) stubbed; stdout and the exit code. */
const efforge = async (args: ReadonlyArray<string>, cwd: string) => {
  const stdout: string[] = []
  const before = process.cwd()
  process.chdir(cwd)
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    stdout.push(a.join(" "))
  })
  vi.spyOn(console, "error").mockImplementation(() => {})
  process.exitCode = undefined
  try {
    await runWith(args).pipe(
      Effect.provide(
        Layer.mergeAll(NodeServices.layer, scriptedPromptIO([]).layer, recordingSpawner([])),
      ),
      Effect.runPromise,
    )
    return { stdout: stdout.join("\n"), exitCode: process.exitCode ?? 0 }
  } finally {
    vi.restoreAllMocks()
    process.exitCode = undefined
    process.chdir(before)
  }
}

const EFFORGE = /^(?:npm create efforge|npx(?: -y)? create-efforge(?:@latest)?)(?:\s|$)/

/** efforge commands in a page: whole lines of ```sh blocks, and code spans in the prose. */
const commandsIn = (text: string): string[] => {
  const blocks = [...text.matchAll(/```sh\n([\s\S]*?)```/g)].flatMap((m) =>
    (m[1] as string).split("\n").map((l) => l.replace(/\s+#.*$/, "").trim()),
  )
  const prose = text.replace(/```[\s\S]*?```/g, "")
  const spans = [...prose.matchAll(/`([^`\n]+)`/g)].map((m) => (m[1] as string).trim())
  return [...blocks, ...spans].filter((c) => EFFORGE.test(c) && !c.includes("<"))
}

/**
 * A command's arguments. `npm create efforge` passes what follows `--`, and a create without
 * flags asks questions, so it runs with `--yes` (the answers the prompts default to).
 */
const argsOf = (line: string): string[] => {
  const words = line.replace(EFFORGE, "").split(/\s+/).filter(Boolean)
  const args = words.filter((w) => w !== "--")
  const create = line.startsWith("npm create") || args[0] === "create"
  return create && !args.some((a) => a === "--yes" || a === "--json") ? [...args, "--yes"] : args
}

const isCreate = (args: ReadonlyArray<string>) =>
  args[0] === "create" || !/^(add|list|info|graph|upgrade|doctor)$/.test(args[0] ?? "")

it.each(["README.md", "docs/deploy.md", "docs/upgrading.md"])(
  "every efforge command in %s runs",
  { timeout: 300_000 },
  async (page) => {
    const lines = commandsIn(read(page))
    if (page === "docs/deploy.md") return expect(lines).toEqual([])
    expect(lines.length).toBeGreaterThan(2)
    for (const line of lines) {
      // each in a directory of its own; a command for a project gets a new default `my-app`
      const work = mkdtempSync(join(tmpdir(), "efforge-guides-"))
      try {
        const args = argsOf(line)
        let cwd = work
        if (!isCreate(args)) {
          expect((await efforge(["create", "my-app", "--yes"], work)).exitCode).toBe(0)
          if (!args.includes("--cwd")) cwd = join(work, "my-app")
        }
        const { stdout, exitCode } = await efforge(args, cwd)
        // 2 is upgrade or doctor reporting what it found (docs/upgrading.md, exit codes)
        const found = exitCode === 2 && /^(upgrade|doctor)$/.test(args[0] ?? "")
        expect(found ? 0 : exitCode, `${line}\n${stdout}`).toBe(0)
        if (args.includes("--json")) expect(JSON.parse(stdout).ok, line).toBe(true)
      } finally {
        rmSync(work, { recursive: true, force: true })
      }
    }
  },
)

it(
  "the README's JSON example is part of what its command prints",
  { timeout: 60_000 },
  async () => {
    const text = read("README.md")
    const m = /<!-- json: (.+?) -->\n```json\n([\s\S]*?)```/.exec(text)
    expect(m).not.toBeNull()
    const [, line = "", body = ""] = m ?? []
    const work = mkdtempSync(join(tmpdir(), "efforge-guides-"))
    try {
      await efforge(["create", "my-app", "--yes"], work)
      const { stdout, exitCode } = await efforge(argsOf(line), work)
      expect(exitCode).toBe(1)
      expect(JSON.parse(stdout)).toMatchObject(JSON.parse(body))
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  },
)

it("the README's diff is what add email does to layers.ts", { timeout: 60_000 }, async () => {
  const m = /<!-- diff: (\S+) after add email -->\n```diff\n([\s\S]*?)```/.exec(read("README.md"))
  expect(m).not.toBeNull()
  const [, file = "", diff = ""] = m ?? []
  const work = mkdtempSync(join(tmpdir(), "efforge-guides-"))
  try {
    await efforge(["create", "my-app", "--yes"], work)
    const project = join(work, "my-app")
    const before = readFileSync(join(project, file), "utf8")
    expect((await efforge(["add", "email"], project)).exitCode).toBe(0)
    const after = readFileSync(join(project, file), "utf8")
    for (const l of diff.split("\n").filter((x) => x !== "" && x.trim() !== "...")) {
      const code = l.slice(1)
      if (l.startsWith("+")) {
        expect(after, l).toContain(code)
        expect(before, l).not.toContain(code)
      } else {
        expect(before, l).toContain(code)
        expect(after, l).toContain(code)
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

/** Commands in a page's code spans: `pnpm ...`, and `DATABASE_URL=... pnpm ...`. */
const shellSpans = (text: string) =>
  new Set(
    [...text.replace(/```[\s\S]*?```/g, "").matchAll(/`([^`\n]+)`/g)]
      .map((m) => m[1] as string)
      .filter((s) => /^(?:pnpm |DATABASE_URL=\S+ pnpm )/.test(s)),
  )

it("docs/deploy.md uses exactly the commands of the generated READMEs' Deploy sections", async () => {
  const addons = await Effect.runPromise(
    loadAddons(defaultTemplatesDir).pipe(Effect.provide(NodeServices.layer)),
  )
  const generated = new Set<string>()
  for (const infra of ["none", "alchemy"] as const)
    for (const [database, orm] of [
      ["postgres", "drizzle"],
      ["d1", "effect-sql"],
      ["d1", "drizzle"],
      ["none", "none"],
    ] as const) {
      const stack = withDefaults({
        name: "my-app",
        database,
        orm,
        auth: database === "none" ? "none" : "better-auth",
        infra,
        ai: "effect-ai-byok",
        extras: ["workflows", "realtime", "browser", "storage", "email"],
      })
      for (const c of shellSpans(readmeRegions({ stack, addons, scripts: {} }).deploy))
        generated.add(c)
    }
  const page = shellSpans(read("docs/deploy.md"))
  // every step the READMEs give is explained, and the guide teaches no command they don't
  expect(
    [...generated].filter((c) => !page.has(c)),
    "missing from docs/deploy.md",
  ).toEqual([])
  expect(
    [...page].filter((c) => !generated.has(c)),
    "not in any generated README",
  ).toEqual([])
})

type FlagDef = { readonly name: string; readonly aliases: ReadonlyArray<string> }
type CommandDef = {
  readonly name: string
  readonly flags: ReadonlyArray<FlagDef>
  readonly subcommands: ReadonlyArray<CommandDef>
}

it("docs/cli.md names every flag of every command in that command's section", () => {
  const cli = Completions.fromCommand(cliRoot) as unknown as CommandDef
  const page = read("docs/cli.md")
  const section = (heading: string) => {
    const start = page.indexOf(`\n## ${heading}`)
    expect(start, heading).toBeGreaterThan(-1)
    const end = page.indexOf("\n## ", start + 1)
    return page.slice(start, end === -1 ? undefined : end)
  }
  const missing: string[] = []
  for (const command of cli.subcommands) {
    const text = section(
      command.name === "create" ? "`npm create efforge`" : `\`efforge ${command.name}`,
    )
    for (const f of command.flags)
      if (!new RegExp(`--(?:no-)?${f.name}\\b`).test(text))
        missing.push(`${command.name} --${f.name}`)
  }
  // the flags every command takes (Effect's CLI adds them), named once on the page
  for (const f of cli.flags) if (!page.includes(`--${f.name}`)) missing.push(`--${f.name}`)
  expect(missing).toEqual([])
  for (const code of ["`0`", "`1`", "`2`", "`3`", "`130`"]) expect(page).toContain(code)
})

it("README.md links and images resolve, all absolute (npm renders the same file)", () => {
  const text = read("README.md").replace(/```[\s\S]*?```/g, "")
  const targets = [...text.matchAll(/\]\(([^)\s]+)\)|(?:src|srcset|href)="([^"]+)"/g)].map(
    (m) => (m[1] ?? m[2]) as string,
  )
  expect(targets.length).toBeGreaterThan(10)
  const problems: string[] = []
  for (const t of targets) {
    if (!t.startsWith("https://")) problems.push(`${t}: relative, which npm cannot resolve`)
    const own =
      /^https:\/\/(?:raw\.githubusercontent\.com\/amagdy46\/efforge\/main|github\.com\/amagdy46\/efforge\/blob\/main)\/([^#?]+)/.exec(
        t,
      )
    if (own !== null && !existsSync(join(root, own[1] as string)))
      problems.push(`${t}: no such file`)
  }
  expect(problems).toEqual([])
})
