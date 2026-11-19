import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { stripVTControlCharacters } from "node:util"
import { afterAll, expect, it } from "vitest"
import { commands } from "../src/fix.ts"

// Every runnable command efforge prints, anywhere, runs without stopping to ask. A first `npx`
// without -y asks "Ok to proceed?" before it downloads, and `npm create` asks the same without
// --yes: both are prompts, which an agent without a terminal can't answer. So this collects what
// efforge really prints (help, errors, next steps, the generated project's files, the schemas) and
// checks every npx and npm create/init/exec in it.

const bin = new URL("../src/bin.ts", import.meta.url).pathname
const root = new URL("..", import.meta.url).pathname
const work = mkdtempSync(join(tmpdir(), "efforge-noninteractive-"))
afterAll(() => rmSync(work, { recursive: true, force: true }))

const run = (args: string[], cwd = work) => {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "1" },
    encoding: "utf8",
    timeout: 60_000,
  })
  return stripVTControlCharacters(`${r.stdout}\n${r.stderr}`)
}

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (name === "node_modules" || name === ".git") return []
    return statSync(p).isDirectory() ? files(p) : [p]
  })

/** Each npx or npm create/init/exec in `text` that would ask before it runs. */
const asking = (text: string): string[] =>
  text.split("\n").flatMap((line) => {
    const bad: string[] = []
    for (const m of line.matchAll(/\b(?:npx|bunx)\s+(\S+)/g))
      if (m[1] !== "-y" && m[1] !== "--yes") bad.push(line.trim())
    for (const m of line.matchAll(/\bnpm\s+(?:create|init|exec)\b(.*)/g))
      if (!/(?:^|\s)(?:--yes|-y)(?:\s|$)/.test((m[1] ?? "").split(" -- ")[0] ?? ""))
        bad.push(line.trim())
    return bad
  })

it("every command efforge prints runs without a prompt of npx or npm", { timeout: 180_000 }, () => {
  const seen: Array<{ where: string; text: string }> = []
  const add = (where: string, text: string) => seen.push({ where, text })

  add("--help", run(["--help"]))
  for (const c of commands) add(`${c} --help`, run([c, "--help"]))

  // two stacks, so both kinds of README, deploy steps and landing page are read
  const stacks = [
    ["wrangler", "--extras=storage,email,realtime,workflows,browser", "--ai=effect-ai-byok"],
    ["alchemy", "--infra=alchemy", "--database=d1", "--orm=effect-sql"],
    ["minimal", "--preset=minimal"],
  ]
  for (const [name, ...flags] of stacks) {
    const n = name as string
    add(`create ${n}`, run(["create", n, "--yes", "--no-install", "--no-git", ...flags]))
    const dir = join(work, n)
    for (const f of files(dir)) add(relative(work, f), readFileSync(f, "utf8"))
    for (const args of [
      ["add"],
      ["add", "stripe"],
      ["add", "emial"],
      ["list"],
      ["info", "email"],
      ["info"],
      ["graph"],
      ["upgrade", "--check"],
      ["doctor"],
    ])
      add(`${args.join(" ")} in ${n}`, run(args, dir))
  }
  // errors outside a project
  for (const args of [
    ["lst"],
    ["zz", "--databse=d1"],
    ["My App"],
    ["zz", "--auth=better-auth", "--database=none"],
    ["add", "email"],
    ["zz"],
  ])
    add(args.join(" "), run(args))
  for (const f of readdirSync(join(root, "schemas")))
    add(`schemas/${f}`, readFileSync(join(root, "schemas", f), "utf8"))

  const all = seen.flatMap(({ where, text }) => asking(text).map((line) => `${where}: ${line}`))
  expect(all).toEqual([])
  // not vacuous: efforge printed its own command many times over
  const printed = seen.reduce((n, s) => n + s.text.split("npx -y create-efforge").length - 1, 0)
  expect(printed).toBeGreaterThan(30)
})
