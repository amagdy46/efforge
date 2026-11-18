import { spawn, spawnSync } from "node:child_process"
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { availableParallelism, tmpdir } from "node:os"
import { delimiter, join, relative, resolve } from "node:path"
import { afterAll, beforeAll, expect, it } from "vitest"
import { isTypo } from "../src/contract.ts"
import { commands, reservedWords } from "../src/fix.ts"

// "`fix` is a promise" (docs/json.md), tested as a property. Invocations are generated from a
// seed (commands, typos, invented verbs, names, flags with good and bad values, `--` anywhere,
// three working directories), plus the 2026-11 re-review's corpus as fixed cases. Each runs against
// the built CLI in its own copy of a sandbox, and its `fix` is followed up to three times. For
// every one: stdout is one document under --json; nothing prompts; no project is created unless
// the original was a create of that name; a fix of anything else never creates; a create's fix
// keeps --no-install, --no-git and --dry-run; a fix never repeats an earlier step and never grows
// on the same error; no flag lands after `--`.
//
// EFFORGE_PROPERTY_SEED and EFFORGE_PROPERTY_CASES change the run; EFFORGE_PROPERTY_BIN runs it
// against another build (an older commit's dist/bin.js, to see it fail).

const SEED = Number(process.env.EFFORGE_PROPERTY_SEED ?? 20261118)
const CASES = Number(process.env.EFFORGE_PROPERTY_CASES ?? 300)
const root = new URL("..", import.meta.url).pathname
const out = join(root, "node_modules", ".cache", "efforge-property")
const bin = process.env.EFFORGE_PROPERTY_BIN ?? join(out, "bin.js")

let work: string
let base: string
let env: NodeJS.ProcessEnv

beforeAll(() => {
  if (process.env.EFFORGE_PROPERTY_BIN === undefined) {
    // the CLI as it ships: one bundled file, which finds templates/ through the package root
    const r = spawnSync(join(root, "node_modules", ".bin", "vp"), ["pack", "-d", out], {
      cwd: root,
      encoding: "utf8",
    })
    expect(r.status, r.stderr).toBe(0)
  }
  work = mkdtempSync(join(tmpdir(), "efforge-property-"))
  const stubs = join(work, ".bin")
  mkdirSync(stubs)
  // installs and git are not what this tests: an install leaves what pnpm's would
  writeFileSync(
    join(stubs, "pnpm"),
    '#!/bin/sh\nif [ "$1" = install ]; then mkdir -p node_modules && touch node_modules/.modules.yaml; fi\nexit 0\n',
  )
  writeFileSync(join(stubs, "git"), '#!/bin/sh\n[ "$1" = init ] && mkdir -p .git\nexit 0\n')
  chmodSync(join(stubs, "pnpm"), 0o755)
  chmodSync(join(stubs, "git"), 0o755)
  env = {
    ...process.env,
    PATH: `${stubs}${delimiter}${process.env.PATH ?? ""}`,
    CI: "1",
    NO_COLOR: "1",
  }
  // the sandbox every case gets a copy of: an empty directory and one D1 project
  base = join(work, "base")
  mkdirSync(join(base, "empty1"), { recursive: true })
  const r = spawnSync(
    process.execPath,
    [bin, "create", "my-app", "--json", "--database=d1", "--auth=better-auth", "--no-install"],
    { cwd: base, env, encoding: "utf8" },
  )
  expect(r.status, r.stdout).toBe(0)
}, 120_000)
afterAll(() => rmSync(work, { recursive: true, force: true }))

// --- Generating invocations ---------------------------------------------------------------

/** mulberry32: small, seeded, the same sequence everywhere. */
const random = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const verbs: Record<"create" | "add" | "list" | "other", ReadonlyArray<ReadonlyArray<string>>> = {
  create: [[], ["create"], ["Create"], ["CREATE"], ["crate"], ["creat"]],
  add: [["add"], ["ad"], ["Add"], ["ADD"], ["adds"]],
  list: [["list"], ["lst"], ["lsit"], ["LIST"], ["List"]],
  other: [
    ["update"],
    ["remove"],
    ["init"],
    ["new"],
    ["install"],
    ["help"],
    ["version"],
    ["ls"],
    ["deploy"],
    ["doctor"],
    ["hlep"],
    ["run"],
    ["foo"],
  ],
}
const names = [
  "my-app",
  "app2",
  "My App",
  "../escape",
  "a/b",
  "",
  "x y",
  "@scope/pkg",
  "-x",
  "List",
  "add",
  "UPPER",
  "n1",
]
const ids = [
  "email",
  "emial",
  "stor",
  "stripe",
  "r2",
  "auth",
  "auth/better-auth",
  "database/postgres",
  "EMAIL",
  "",
  "orm/drizzle",
  "ai",
  "ai/none",
  "workflows",
]
const flags = [
  ["--dry-run"],
  ["--no-install"],
  ["--no-git"],
  ["--yes"],
  ["-y"],
  ["--json=false"],
  ["--cwd", "my-app"],
  ["--cwd=my-app"],
  ["--cwd"],
  ["--cwd", "nope"],
  ["--cwd", "my-app/package.json"],
  ["--cwd", "empty1"],
  ["--database=d1"],
  ["--database=postgress"],
  ["--database=mysql"],
  ["--database=none"],
  ["--database"],
  ["--orm=drizle"],
  ["--orm=none"],
  ["--auth=better-auth"],
  ["--auth=none"],
  ["--extras=email,emial"],
  ["--extras=stripe"],
  ["--extras="],
  ["--databse=d1"],
  ["--jsn"],
  ["--no-instal"],
  ["--install=maybe"],
  ["--completions=nushell"],
  ["--completions"],
  ["--log-level=nope"],
  ["--log-level=debug"],
  ["--name=n2"],
  ["--overwrite"],
  ["--with-stripe"],
  ["--ai"],
  ["--infra=alchmy"],
]
const where = ["", "", "", "my-app", "my-app", "my-app/apps/web"]

interface Case {
  readonly args: ReadonlyArray<string>
  /** Relative to the sandbox. */
  readonly cwd: string
}

const generate = (seed: number, count: number): Case[] => {
  const next = random(seed)
  const pick = <A>(xs: ReadonlyArray<A>): A => xs[Math.floor(next() * xs.length)] as A
  const cases: Case[] = []
  for (let n = 0; n < count; n++) {
    const kind = pick(["create", "create", "add", "add", "list", "other"] as const)
    const verb = [...pick(verbs[kind])]
    const words: string[] = []
    const many = Math.floor(next() * 3)
    for (let k = 0; k < many; k++)
      words.push(kind === "add" ? pick(ids) : kind === "list" ? pick(["extra", "x"]) : pick(names))
    const opts: string[] = []
    if (next() < 0.85) opts.push("--json")
    const extra = Math.floor(next() * 4)
    for (let k = 0; k < extra; k++) opts.push(...pick(flags))
    if (kind === "create" && next() < 0.6 && !opts.includes("--dry-run")) opts.push("--dry-run")
    // the command word usually comes first, sometimes after the flags
    let args = next() < 0.85 ? [...verb, ...words, ...opts] : [...opts, ...verb, ...words]
    if (next() < 0.25) {
      const at = Math.floor(next() * (args.length + 1))
      args = [...args.slice(0, at), "--", ...args.slice(at)]
    }
    cases.push({ args, cwd: pick(where) })
  }
  return cases
}

/** The re-review's corpus (reports/wa2-rereview.md, section 3 and the repros in section 1). */
const reviewed: Case[] = [
  ...[
    ["lits", "--json"],
    ["adds", "storage", "--json", "--cwd", "my-app", "--dry-run"],
    ["Add", "email", "--json", "--cwd", "my-app", "--dry-run"],
    ["ad", "--cwd=my-app", "--json", "email", "--dry-run"],
    ["Help", "--json"],
    ["new", "my-app2", "--json"],
    ["add email", "--json", "--cwd", "my-app"],
    ["version", "--json"],
    ["ls", "--json", "--dry-run"],
    ["init", "--json", "--dry-run"],
    ["remove", "--json", "--dry-run"],
    ["install", "--json", "--dry-run"],
    ["LIST", "--json", "--dry-run"],
    ["HELP", "--json", "--dry-run"],
    ["CREATE", "--json", "--dry-run"],
    ["ADD", "--json"],
    ["--json", "lst"],
    ["--cwd", "my-app", "ad", "email", "--json", "--dry-run"],
    ["--cwd", "my-app", "list", "--json"],
    ["add", "--json", "--", "email"],
    ["add", "--json", "--dry-run", "--", "email"],
    ["list", "--json", "--", "extra"],
    ["create", "--json", "--install=maybe", "--", "nm1"],
    ["create", "--json", "--dry-run", "--databse=d1", "--", "nm2"],
    ["add", "email", "--json", "--dry-run", "--cwd", "my-app", "--", "storage"],
    ["--", "lst", "--json"],
    ["lst", "--", "--json"],
    ["create", "--", "my-app3", "--json"],
    ["create", "--", "--json"],
    ["add", "--", "email", "--cwd", "my-app", "--json"],
    ["my-app4", "--databse=d1", "--", "--dry-run"],
    ["my app", "--json", "--dry-run"],
    ["create", "my app", "--json", "--dry-run"],
    ["create", "My Cool App", "--json", "--dry-run"],
    ["create", "", "--json", "--dry-run"],
    ["", "--json", "--dry-run"],
    ["create", "../escape", "--json", "--dry-run"],
    ["create", "my-app/sub", "--json", "--dry-run"],
    ["create", "-my-app", "--json"],
    ["create", "add", "--json", "--dry-run"],
    ["create", ".", "--json"],
    ["create", "--name", "app3", "--json"],
    ["create", "--name=app3", "--json"],
    ...[
      "--orm=drizle",
      "--auth=better-auth-org",
      "--auth=better-auth-or",
      "--auth=betterauth",
      "--database=postgre",
      "--database=non",
      "--infra=alchmy",
      "--database=D1",
      "--database=sqlite",
      "--ai=openai",
      "--orm=prisma",
      "--extras=email,emial",
      "--extras=stroage,emial",
      "--extras=stroage,stripe",
      "--no-instal",
      "--dryrun",
      "--jsn",
      "--install=maybe",
      "--log-level=nope",
      "--ai",
      "--template=next",
      "--database=mysql",
      "--database=d2",
    ].map((f) => ["create", "app3", "--json", "--dry-run", f]),
    ["create", "jf", "--json=false", "--databse=d1"],
    ["list", "--json", "--overwrite"],
    ["list", "--jsno"],
    ["add", "email", "--json", "--cwd", "my-app", "--yes"],
    ["add", "email", "--databse=d1", "--json", "--cwd", "my-app"],
    ...[
      ["better"],
      ["auth"],
      ["eff"],
      ["data"],
      ["orm"],
      ["stor"],
      ["post"],
      ["mail"],
      ["extras/emial"],
      ["extra/email"],
      ["EMAIL"],
      ["email", "nope"],
      ["emial", "storag"],
      [""],
      ["--overwrite"],
      ["runtime/cloudflare"],
      ["r2"],
      ["kv"],
      ["s3"],
      ["db"],
      ["do"],
      ["sql"],
      ["foo"],
      ["stripe"],
    ].map((x) => ["add"].concat(x, ["--json", "--cwd", "my-app"])),
    ["list", "--json", "--cwd", "my-app/package.json"],
    ["list", "--json", "--cwd", "nope/missing"],
    ["add", "email", "--json", "--cwd", "nope/missing"],
    ["add", "email", "--json", "--cwd", "my-app/package.json"],
    ["add", "email", "--json", "--cwd", "my-app/apps/web"],
    ["add", "email", "--json", "--cwd"],
    ["add", "email", "--json", "--cwd", "my-app", "--cwd", "empty1"],
    ["--version", "--json"],
    ["--json", "--version"],
    ["create", "--version", "--json"],
    ["add", "--version", "--json"],
    ["list", "--version", "--json"],
    ["--version", "--json", "extra"],
    ["--version=true", "--json"],
    ["-v", "--json"],
    ["--help", "--json"],
    ["add", "--help", "--json"],
    ["--completions=nope", "--json"],
    ["--completions", "--json"],
    ["--json"],
    ["lst", "--json", "--cwd", "my-app"],
    ["ad", "email", "--json", "--cwd", "my-app"],
    ["remove", "email", "--json", "--cwd", "my-app"],
    ["crate", "app2", "--json", "--database=d1"],
    ["create", "my-app", "--json", "--database=postgres", "--extras=email"],
    ["create", "my-app", "--json", "--no-install", "--database=d1", "--auth=better-auth"],
  ].map((args) => ({ args, cwd: "" })),
  { args: ["update", "--json", "--no-install", "--no-git"], cwd: "my-app" },
  { args: ["--json"], cwd: "my-app" },
  { args: ["list", "--json"], cwd: "my-app/apps/web" },
  { args: ["add", "storage", "--json", "--dry-run"], cwd: "my-app/apps/web" },
]

// --- Running ------------------------------------------------------------------------------

interface Run {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

const run = (command: string, args: ReadonlyArray<string>, cwd: string): Promise<Run> =>
  new Promise((done) => {
    const child = spawn(command, [...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d: Buffer) => (stdout += String(d)))
    child.stderr.on("data", (d: Buffer) => (stderr += String(d)))
    // a prompt would wait for input that never comes
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000)
    child.on("close", (status) => {
      clearTimeout(timer)
      done({ status, stdout, stderr })
    })
  })

/** Splits a `fix` like the shell would: `cd x && npx -y create-efforge ...`, single quotes. */
const split = (part: string): string[] =>
  [...part.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)].map(
    (m) => m[1]?.replaceAll(`'\\''`, "'") ?? (m[2] as string),
  )

/** `--json` before `--`, not turned off: the CLI's own reading. */
const wantsJson = (args: ReadonlyArray<string>) => {
  const end = args.indexOf("--")
  return (end < 0 ? args : args.slice(0, end)).some(
    (a) => a === "--json" || /^--json=(?:true|yes|on|1|y)$/i.test(a),
  )
}

/** The documented exceptions: built-in flags print text for people, with or without --json. */
const builtIn = (args: ReadonlyArray<string>) => {
  const end = args.indexOf("--")
  return (end < 0 ? args : args.slice(0, end)).some((a) =>
    /^(?:--help|-h|--version|-v|--wizard)(?:=|$)/.test(a),
  )
}

const valueFlags = ["database", "orm", "auth", "infra", "ai", "extras", "cwd", "runtime"]
const valueFlags2 = ["completions", "log-level"]

/** Positional words, read independently of the code under test. */
const words = (args: ReadonlyArray<string>): string[] => {
  const found: string[] = []
  for (let i = 0; i < args.length; i++) {
    const t = args[i] as string
    if (t === "--") return [...found, ...args.slice(i + 1)]
    if (t.startsWith("-") && t !== "-") {
      const name = t.replace(/^-+/, "").split("=")[0] as string
      const next = args[i + 1]
      if (
        !t.includes("=") &&
        [...valueFlags, ...valueFlags2].includes(name) &&
        next !== undefined &&
        !next.startsWith("-")
      )
        i++
      continue
    }
    found.push(t)
  }
  return found
}

const nameFlag = (args: ReadonlyArray<string>) =>
  args.find((a) => a.startsWith("--name="))?.slice("--name=".length)

/** The directory a create of `name` makes, from the name as the caller meant it; or undefined. */
const dirFor = (name: string): string | undefined => {
  const meant = name.trim().toLowerCase().replace(/\s+/g, "-")
  if (meant === "" || meant === "." || meant.includes("..")) return undefined
  if (meant.includes("/")) return /^@[^/]+\/[^/]+$/.test(meant) ? meant.split("/")[1] : undefined
  return meant
}

/** The name a create attempt asked for (`my-app` when none), or undefined for anything else. */
const createOf = (args: ReadonlyArray<string>, inProject: boolean): string | undefined => {
  // `--completions` prints a script: whatever else is there, it was never a create
  const end = args.indexOf("--")
  if ((end < 0 ? args : args.slice(0, end)).some((a) => /^--completions(?:=|$)/.test(a)))
    return undefined
  const w = words(args)
  const [first] = w
  const lower = first?.toLowerCase()
  if (lower !== undefined && (lower === "create" || isTypo(lower, "create")))
    return w.length > 2 ? undefined : (w[1] ?? nameFlag(args) ?? "my-app")
  // the root form: one word that isn't a command or a word kept for one, outside a project
  if (inProject || w.length > 1) return undefined
  if (lower !== undefined) {
    if (reservedWords.includes(lower)) return undefined
    if (commands.some((c) => lower === c || isTypo(lower, c))) return undefined
  }
  return first ?? nameFlag(args) ?? "my-app"
}

/** Every efforge.jsonc under `dir` (projects), skipping node_modules and .git. */
const projects = (dir: string): string[] => {
  const found: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git") continue
      if (e.isDirectory()) walk(join(d, e.name))
      else if (e.name === "efforge.jsonc") found.push(relative(dir, d))
    }
  }
  walk(dir)
  return found.toSorted()
}

const knownFlags = new Set([
  "json",
  "dry-run",
  "yes",
  "install",
  "no-install",
  "git",
  "no-git",
  "overwrite",
  "cwd",
  ...valueFlags,
  ...valueFlags2,
])

/** Checks one case; returns what broke the promise, empty when nothing did. */
const check = async (c: Case, n: number): Promise<string[]> => {
  const box = join(work, `case-${n}`)
  const sandbox = join(box, "w")
  cpSync(base, sandbox, { recursive: true })
  const problems: string[] = []
  const say = (s: string) => problems.push(`${JSON.stringify(c)}: ${s}`)
  try {
    const before = projects(box)
    const start = join(sandbox, c.cwd)
    const asked = createOf(c.args, c.cwd !== "")
    const allowed = asked === undefined ? undefined : dirFor(asked)
    const afterDashes = (a: ReadonlyArray<string>) => {
      const end = a.indexOf("--")
      return end < 0 ? [] : a.slice(end + 1)
    }
    const isCreate = (args: ReadonlyArray<string>) => {
      const [first] = words(args)
      return first !== "add" && first !== "list"
    }
    const seen = new Set<string>()
    let step: { args: string[]; cwd: string } | undefined = { args: [...c.args], cwd: start }
    let last: { code: string; length: number } | undefined
    for (let hop = 0; hop < 4 && step !== undefined; hop++) {
      const key = `${step.cwd}\0${step.args.join("\0")}`
      if (seen.has(key)) {
        say(`hop ${hop} repeats an earlier step (a loop): ${step.args.join(" ")}`)
        break
      }
      seen.add(key)
      const r = await run(process.execPath, [bin, ...step.args], step.cwd)
      if (r.status === null) {
        say(`hop ${hop} didn't finish (a prompt?): ${step.args.join(" ")}`)
        break
      }
      // a fix never needs an answer it can't get
      if (hop > 0 && (r.stdout + r.stderr).includes("No terminal to ask for"))
        say(`hop ${hop}: the fix needs a prompt: ${step.args.join(" ")}`)
      let fix: string | null = null
      let code = ""
      if (wantsJson(step.args) && !builtIn(step.args)) {
        if (r.stderr !== "")
          say(`hop ${hop} wrote to stderr under --json: ${r.stderr.slice(0, 200)}`)
        let doc: { ok?: boolean; error?: { code?: string; fix?: string | null } } | undefined
        try {
          doc = JSON.parse(r.stdout) as typeof doc
        } catch {
          say(`hop ${hop} stdout isn't one JSON document: ${r.stdout.slice(0, 200)}`)
          break
        }
        if (typeof doc?.ok !== "boolean") say(`hop ${hop}: no ok field`)
        if ((r.status === 0) !== (doc?.ok === true))
          say(`hop ${hop}: exit ${r.status}, ok ${doc?.ok}`)
        fix = doc?.error?.fix ?? null
        code = doc?.error?.code ?? ""
      } else if (!builtIn(step.args)) {
        const line = r.stderr.split("\n").find((l) => l.startsWith("Try: "))
        fix = line === undefined ? null : line.slice("Try: ".length)
        code = r.stderr.split("\n")[0] ?? ""
      }
      if (fix === null) break
      // a fix that isn't efforge: setup steps, only for a create or an add, never a create
      const parts = fix.split(" && ")
      const efforge = parts.findIndex((p) => p.startsWith("npx -y create-efforge"))
      if (efforge < 0) {
        if (fix.includes("create-efforge")) say(`hop ${hop}: odd fix ${fix}`)
        if (fix.includes("pnpm install") && c.args.includes("--no-install"))
          say(`hop ${hop}: the fix installs though the caller passed --no-install: ${fix}`)
        if (fix.includes("git commit") && c.args.includes("--no-git"))
          say(`hop ${hop}: the fix commits though the caller passed --no-git: ${fix}`)
        await run("sh", ["-c", fix], step.cwd)
        break
      }
      let cwd: string = step.cwd
      for (const p of parts.slice(0, efforge)) {
        const t = split(p)
        if (t[0] === "cd") cwd = resolve(cwd, t[1] as string)
      }
      const tokens = split(parts.slice(efforge).join(" && "))
      const args = tokens.slice(3)
      // after `--` only what the caller put there: a flag the fix adds goes before it
      const theirs = afterDashes(c.args)
      const added = afterDashes(args).filter((t) => !theirs.includes(t))
      if (
        added.some((t) => t.startsWith("--") && knownFlags.has(t.slice(2).split("=")[0] as string))
      )
        say(`hop ${hop}: the fix puts a flag after --: ${fix}`)
      if (isCreate(args)) {
        const w = words(args)
        const name = (w[0]?.toLowerCase() === "create" ? w[1] : w[0]) ?? "my-app"
        if (asked === undefined) say(`hop ${hop}: the fix of a non-create is a create: ${fix}`)
        else if ((name !== asked && dirFor(name) !== allowed) || cwd !== start)
          say(`hop ${hop}: the fix creates ${name} in ${relative(sandbox, cwd)}, not ${asked}`)
        for (const kept of ["--no-install", "--no-git", "--dry-run"])
          if (c.args.includes(kept) && !args.includes(kept))
            say(`hop ${hop}: the fix drops ${kept}`)
      }
      if (last !== undefined && last.code === code && args.length > last.length)
        say(`hop ${hop}: the fix grew on the same error ${code}: ${fix}`)
      last = { code, length: args.length }
      step = { args, cwd }
    }
    const made = projects(box).filter((p) => !before.includes(p))
    const ok = allowed === undefined ? [] : [relative(box, join(start, allowed))]
    for (const p of made) if (!ok.includes(p)) say(`created a project nobody asked for: ${p}`)
    const stray = readdirSync(box).filter((x) => x !== "w")
    if (stray.length > 0) say(`wrote outside the sandbox: ${stray.join(", ")}`)
  } finally {
    rmSync(box, { recursive: true, force: true })
  }
  return problems
}

const all = async (cases: ReadonlyArray<Case>, offset: number): Promise<string[]> => {
  const problems: string[] = []
  let next = 0
  const lanes = Math.max(2, Math.min(8, availableParallelism() - 2))
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      while (next < cases.length) {
        const n = next++
        problems.push(...(await check(cases[n] as Case, offset + n)))
      }
    }),
  )
  return problems
}

it(
  `fix is a promise: ${CASES} generated invocations (seed ${SEED})`,
  { timeout: 600_000 },
  async () => {
    const started = Date.now()
    const problems = await all(generate(SEED, CASES), 0)
    console.log(`property: seed ${SEED}, ${CASES} cases, ${Date.now() - started} ms`)
    expect(problems).toEqual([])
  },
)

it(
  `fix is a promise: the re-review's ${reviewed.length} invocations`,
  { timeout: 600_000 },
  async () => {
    expect(existsSync(bin)).toBe(true)
    expect(await all(reviewed, 100_000)).toEqual([])
  },
)
