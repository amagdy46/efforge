import { spawn, spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { Schema } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AddOutput, CreateOutput, ErrorOutput, ListOutput } from "../src/schemas.ts"

// What a coding agent sees: the real CLI as a child process, stdin closed, CI=1, --json. pnpm is
// a stub on PATH (installs are not what this tests); git is real. Every error an agent is likely
// to hit must come back as one JSON document whose `fix` is a command that then succeeds.

const bin = new URL("../src/bin.ts", import.meta.url).pathname
let work: string
let env: NodeJS.ProcessEnv

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "efforge-agent-"))
  const stubs = join(work, ".bin")
  mkdirSync(stubs)
  // an install leaves what pnpm's would: node_modules/.modules.yaml
  writeFileSync(
    join(stubs, "pnpm"),
    '#!/bin/sh\nif [ "$1" = install ]; then mkdir -p node_modules && touch node_modules/.modules.yaml; fi\nexit 0\n',
  )
  chmodSync(join(stubs, "pnpm"), 0o755)
  env = {
    ...process.env,
    PATH: `${stubs}${delimiter}${process.env.PATH ?? ""}`,
    CI: "1",
    NO_COLOR: "1",
    GIT_AUTHOR_NAME: "Agent",
    GIT_AUTHOR_EMAIL: "agent@example.com",
    GIT_COMMITTER_NAME: "Agent",
    GIT_COMMITTER_EMAIL: "agent@example.com",
  }
})
afterAll(() => rmSync(work, { recursive: true, force: true }))

interface Run {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

const efforge = (args: ReadonlyArray<string>, cwd = work): Run => {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 60_000,
  })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

/** The whole of stdout is one JSON document, and nothing went to stderr. */
const json = (r: Run): Record<string, unknown> & { ok: boolean } => {
  expect(r.stderr).toBe("")
  return JSON.parse(r.stdout)
}

const ok = <S extends Schema.Top>(schema: S, args: ReadonlyArray<string>, cwd = work) => {
  const r = efforge(args, cwd)
  const doc = json(r)
  expect(doc.ok, r.stdout).toBe(true)
  expect(r.status).toBe(0)
  return Schema.decodeUnknownSync(schema as never)(doc) as S["Type"]
}

const failure = (args: ReadonlyArray<string>, cwd = work) => {
  const r = efforge(args, cwd)
  const doc = json(r)
  expect(doc.ok, r.stdout).toBe(false)
  expect(r.status).toBe(1)
  // the schema checks the common fields; the code's own fields (suggestions, files...) stay
  Schema.decodeUnknownSync(ErrorOutput)(doc)
  return doc.error as typeof ErrorOutput.Type.error & Record<string, unknown>
}

/** Splits a `fix` like the shell would (`cd x && npx create-efforge ...`, single quotes). */
const parseFix = (fix: string, cwd: string): { args: string[]; cwd: string } => {
  let dir = cwd
  let args: string[] = []
  for (const part of fix.split(" && ")) {
    const tokens = [...part.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)].map(
      (m) => m[1]?.replaceAll(`'\\''`, "'") ?? (m[2] as string),
    )
    if (tokens[0] === "cd") dir = join(dir, tokens[1] as string)
    else {
      expect(tokens.slice(0, 3)).toEqual(["npx", "-y", "create-efforge"])
      args = tokens.slice(3)
    }
  }
  return { args, cwd: dir }
}

/** Runs `fix` and expects it to succeed with one JSON document. */
const runFix = <S extends Schema.Top>(schema: S, fix: string | null, cwd = work) => {
  expect(fix).not.toBeNull()
  const f = parseFix(fix as string, cwd)
  return ok(schema, f.args, f.cwd)
}

const manifest = (dir: string) =>
  JSON.parse(readFileSync(join(dir, "efforge.jsonc"), "utf8").replace(/^\/\/.*\n/, ""))

describe("an agent drives efforge without a terminal", { timeout: 120_000 }, () => {
  it("create, list, add: every step is one JSON document with what to do next", () => {
    const created = ok(CreateOutput, [
      "create",
      "app",
      "--json",
      "--database=d1",
      "--auth=better-auth",
    ])
    const dir = join(work, "app")
    expect(created.directory).toBe(dir)
    expect(created.stack).toMatchObject({ database: "d1", orm: "drizzle", auth: "better-auth" })
    expect(created.installed).toBe(true)
    expect(created.git).toBe("committed")
    expect(created.files).toContain("efforge.jsonc")
    expect(created.nextSteps.map((s) => s.command)).toEqual(["pnpm db:migrate", "pnpm dev"])
    expect(created.nextSteps.every((s) => s.cwd === dir)).toBe(true)
    expect(created.env.map((v) => v.name)).toContain("BETTER_AUTH_SECRET")
    expect(manifest(dir).$schema).toMatch(/schemas\/efforge\.schema\.json$/)

    const listed = ok(ListOutput, ["list", "--json", "--cwd", "app"])
    expect(listed.project).toBe(true)
    expect(listed.addons.find((a) => a.id === "auth/better-auth")?.installed).toBe(true)
    expect(listed.addons.find((a) => a.id === "extras/email")?.installed).toBe(false)

    const added = ok(AddOutput, ["add", "email", "--json", "--cwd", "app"])
    expect(added.added.map((a) => a.id)).toEqual(["extras/email"])
    expect(added.created).toContain("packages/core/src/mailer.ts")
    expect(added.changed).toContain("apps/web/src/server/layers.ts")
    expect(added.env.map((v) => v.name)).toEqual(["MAIL_FROM", "MAIL_TRANSPORT"])
    expect(added.stack.extras).toEqual(["email"])
    expect(manifest(dir).stack.extras).toEqual(["email"])
    expect(readFileSync(join(dir, "apps/web/src/server/layers.ts"), "utf8")).toContain("MailerLive")
  })

  it("an unknown flag: fix uses the closest one", () => {
    const e = failure(["create", "typo", "--json", "--dry-run", "--databse=d1"])
    expect(e.code).toBe("UnknownFlag")
    expect(e.fix).toBe("npx -y create-efforge create typo --json --dry-run --database=d1")
    expect(runFix(CreateOutput, e.fix).stack.database).toBe("d1")
  })

  it("a mistyped command doesn't create a project named after it", () => {
    const e = failure(["lst", "--json"])
    expect(e.code).toBe("UnknownCommand")
    expect(existsSync(join(work, "lst"))).toBe(false)
    expect(runFix(ListOutput, e.fix).addons.length).toBeGreaterThan(0)
  })

  it("following fix from a bad command never creates a project nobody asked for", () => {
    // each: the invocation, and the one project it may create (when it was meant as a create)
    const corpus: ReadonlyArray<readonly [ReadonlyArray<string>, string | undefined]> = [
      [["ad", "email", "--json", "--cwd", "app"], undefined],
      [["lst", "--json", "--cwd", "app"], undefined],
      [["lsit", "--json"], undefined],
      [["remove", "email", "--json", "--cwd", "app"], undefined],
      [["install", "email", "--json"], undefined],
      [["foo", "--json", "--cwd", "app"], undefined],
      [["help", "--json"], undefined],
      [["hlep", "--json"], undefined],
      [["version", "--json"], undefined],
      [["upgrade", "--json", "--cwd", "app"], undefined],
      [["doctor", "--json"], undefined],
      [["my", "app", "--json"], undefined],
      [["create", "two", "words", "--json"], undefined],
      [["crate", "corpus-a", "--json", "--dry-run"], "corpus-a"],
      [["add", "stripe", "--json", "--cwd", "app"], undefined],
      [["add", "r2", "--json", "--cwd", "app"], undefined],
      [["list", "extra", "--json", "--cwd", "app"], undefined],
    ]
    const entries = () => new Set(readdirSync(work))
    for (const [args, allowed] of corpus) {
      const before = entries()
      let next: { args: string[]; cwd: string } | undefined = { args: [...args], cwd: work }
      for (let hop = 0; hop < 3 && next !== undefined; hop++) {
        const r = efforge(next.args, next.cwd)
        const doc = json(r)
        const fix = doc.ok ? null : (doc.error as { fix: string | null }).fix
        next = fix === null ? undefined : parseFix(fix, next.cwd)
      }
      const made = [...entries()].filter((x) => !before.has(x))
      expect(made, args.join(" ")).toEqual([])
      if (allowed !== undefined) expect(existsSync(join(work, allowed))).toBe(false)
    }
    // a mistyped create is corrected to the create that was meant, under the name given
    const e = failure(["crate", "corpus-b", "--json", "--no-git"])
    expect(e).toMatchObject({ code: "UnknownCommand", suggestion: "create" })
    expect(e.fix).toBe("npx -y create-efforge create corpus-b --json --no-git")
    expect(runFix(CreateOutput, e.fix).stack.name).toBe("corpus-b")
  })

  it("a mistyped add is the add, with its arguments", () => {
    const e = failure(["ad", "email", "--json", "--cwd", "app", "--dry-run"])
    expect(e).toMatchObject({ code: "UnknownCommand", suggestion: "add" })
    expect(e.fix).toBe("npx -y create-efforge add email --json --cwd app --dry-run")
    expect(runFix(AddOutput, e.fix).skipped).toContain("extras/email")
  })

  it("help, an invented command and stray words are refused with no fix", () => {
    expect(failure(["help", "--json"])).toMatchObject({ code: "UnknownCommand", fix: null })
    expect(existsSync(join(work, "help"))).toBe(false)
    const invented = failure(["remove", "email", "--json", "--cwd", "app"])
    expect(invented).toMatchObject({ code: "UnknownCommand", fix: null })
    expect(invented.commands).toEqual(["create", "add", "list", "info", "graph"])
    expect(failure(["create", "my", "app", "--json"])).toMatchObject({
      code: "UnexpectedArgument",
      fix: null,
    })
  })

  it("an unknown value: fix uses the one it is a typo of; conflicting choices: no fix, every way out", () => {
    const unknown = failure(["create", "v", "--json", "--dry-run", "--database=postgress"])
    expect(unknown.code).toBe("UnknownValue")
    expect(unknown.allowed).toEqual(["postgres", "d1", "none"])
    expect(runFix(CreateOutput, unknown.fix).stack.database).toBe("postgres")

    const conflict = failure([
      "create",
      "v",
      "--json",
      "--dry-run",
      "--database=none",
      "--auth=better-auth",
    ])
    // --auth=none would drop the auth asked for, --database=d1 would pick a database: the
    // caller's choice, so each way out is data, as a complete command
    expect(conflict).toMatchObject({ code: "IncompatibleStack", fix: null })
    const ways = conflict.alternatives as Array<{ command: string; description: string }>
    expect(ways.map((w) => w.description)).toEqual([
      "Use --database=postgres instead of --database=none",
      "Use --database=d1 instead of --database=none",
      "Use --auth=none instead of --auth=better-auth",
    ])
    for (const w of ways) runFix(CreateOutput, w.command)
    expect(runFix(CreateOutput, ways[1]?.command ?? null).stack).toMatchObject({
      name: "v",
      database: "d1",
      auth: "better-auth",
    })
  })

  it("a value efforge doesn't offer gets no fix, only the allowed values", () => {
    for (const value of ["mysql", "d2", "sqlite"]) {
      const e = failure(["create", "v", "--json", "--dry-run", `--database=${value}`])
      expect(e).toMatchObject({ code: "UnknownValue", fix: null })
      expect(e.allowed).toEqual(["postgres", "d1", "none"])
    }
    const extra = failure(["create", "v", "--json", "--dry-run", "--extras=email,stripe"])
    expect(extra).toMatchObject({ code: "UnknownValue", fix: null })
    const missing = failure(["create", "v", "--json", "--dry-run", "--database"])
    expect(missing).toMatchObject({ code: "InvalidFlagValue", fix: null })
    expect(missing.allowed).toEqual(["postgres", "d1", "none"])
    const flag = failure(["create", "v", "--json", "--dry-run", "--with-stripe"])
    expect(flag).toMatchObject({ code: "UnknownFlag", fix: null })
  })

  it("an invalid project name: fix uses a valid one", () => {
    const e = failure(["create", "My App", "--json", "--dry-run"])
    expect(e.code).toBe("InvalidProjectName")
    expect(runFix(CreateOutput, e.fix).stack.name).toBe("my-app")
  })

  it("a directory that isn't empty: never a second project under another name", () => {
    mkdirSync(join(work, "taken"))
    writeFileSync(join(work, "taken", "notes.txt"), "mine")
    const e = failure(["create", "taken", "--json", "--no-git"])
    expect(e).toMatchObject({ code: "TargetNotEmpty", fix: null, project: false })
    expect(readFileSync(join(work, "taken", "notes.txt"), "utf8")).toBe("mine")
    expect(existsSync(join(work, "taken-2"))).toBe(false)
  })

  it("a retry over a project that was set up: it says so, and how to use it", () => {
    const again = failure(["create", "app", "--json", "--database=d1", "--auth=better-auth"])
    expect(again).toMatchObject({ code: "TargetNotEmpty", project: true, fix: null })
    expect((again.stack as { name: string }).name).toBe("app")
    expect((again.nextSteps as Array<{ command: string }>).map((x) => x.command)).toEqual([
      "pnpm db:migrate",
      "pnpm dev",
    ])
  })

  it("a retry over a create that stopped early: fix finishes it, no second project", () => {
    ok(CreateOutput, ["create", "halfway", "--json", "--no-install", "--database=d1"])
    // what an interrupted run leaves: the files and a repo, no install, no commit
    rmSync(join(work, "halfway", ".git"), { recursive: true, force: true })
    spawnSync("git", ["init", "-q"], { cwd: join(work, "halfway") })
    const e = failure(["create", "halfway", "--json", "--database=d1"])
    expect(e).toMatchObject({ code: "TargetNotEmpty", project: true })
    expect(e.remaining).toEqual([
      "pnpm install --no-frozen-lockfile",
      "pnpm format",
      "git add -A && git commit -m 'Initial commit'",
    ])
    expect(e.fix).toBe(
      "cd halfway && pnpm install --no-frozen-lockfile && pnpm format && git add -A && git commit -m 'Initial commit'",
    )
    expect(readdirSync(work).filter((x) => x.startsWith("halfway"))).toEqual(["halfway"])
  })

  it("an unknown add-on id: fix uses the one suggestion", () => {
    const e = failure(["add", "storag", "--json", "--cwd", "app", "--dry-run"])
    expect(e.code).toBe("UnknownAddon")
    expect(e.suggestions).toEqual(["extras/storage"])
    expect(runFix(AddOutput, e.fix).added.map((a) => a.id)).toEqual(["extras/storage"])
  })

  it("an add-on efforge doesn't have gets no fix, only the ids", () => {
    for (const id of ["stripe", "r2", "kv", "db", "sql", "foo"]) {
      const e = failure(["add", id, "--json", "--cwd", "app"])
      expect(e, id).toMatchObject({ code: "UnknownAddon", fix: null, suggestions: [] })
      expect(e.addons).toContain("extras/storage")
      expect(e.message).toContain("list --json")
    }
    const typo = failure(["add", "emial", "--json", "--cwd", "app"])
    expect(typo.fix).toBe("npx -y create-efforge add extras/email --json --cwd app")
  })

  it("add with no ids lists what the project can still add", () => {
    const e = failure(["add", "--json", "--cwd", "app"])
    expect(e.code).toBe("NoAddonIds")
    expect(e.available).toContain("extras/storage")
    expect(e.available).not.toContain("extras/email")
    runFix(ListOutput, e.fix)
  })

  it("add without efforge.jsonc: fix points --cwd at the project", () => {
    const inside = join(work, "app", "apps", "web")
    const e = failure(["add", "storage", "--json", "--dry-run"], inside)
    expect(e.code).toBe("NotAnEfforgeProject")
    expect(e.project).toBe(join(work, "app"))
    expect(runFix(AddOutput, e.fix, inside).directory).toBe(join(work, "app"))

    const nowhere = mkdtempSync(join(work, "empty-"))
    const lost = failure(["add", "storage", "--json"], nowhere)
    expect(lost.code).toBe("NotAnEfforgeProject")
    expect(lost.fix).toBeNull()
  })

  it("add that needs other add-ons: no fix, each way out as a command", () => {
    ok(CreateOutput, ["create", "nodb", "--json", "--database=none", "--no-git"])
    const e = failure(["add", "auth/better-auth", "--json", "--dry-run", "--cwd", "nodb"])
    // a database and an ORM can't be swapped later, so efforge doesn't choose them
    expect(e).toMatchObject({ code: "IncompatibleStack", fix: null })
    expect(e.needs).toEqual([
      { slot: "database", options: ["database/postgres", "database/d1"] },
      { slot: "orm", options: ["orm/drizzle", "orm/effect-sql"] },
    ])
    const ways = e.alternatives as Array<{ command: string; description: string }>
    expect(ways.map((w) => w.command)).toContain(
      "npx -y create-efforge add database/d1 orm/effect-sql auth/better-auth --json --dry-run --cwd nodb",
    )
    expect(ways).toHaveLength(4)
    for (const w of ways)
      expect(runFix(AddOutput, w.command).added.map((a) => a.id)).toContain("auth/better-auth")
  })

  it("add over a file you edited: nothing is written, fix overwrites it", () => {
    ok(CreateOutput, [
      "create",
      "edited",
      "--json",
      "--database=d1",
      "--orm=effect-sql",
      "--auth=none",
      "--no-git",
    ])
    // the /app layout: base writes it, auth replaces it
    const dashboard = join(work, "edited", "apps/web/src/routes/app.tsx")
    writeFileSync(dashboard, `${readFileSync(dashboard, "utf8")}// mine\n`)
    const e = failure(["add", "auth/better-auth", "--json", "--cwd", "edited"])
    expect(e.code).toBe("OverlayConflict")
    expect(e.files).toEqual(["apps/web/src/routes/app.tsx"])
    expect(manifest(join(work, "edited")).stack.auth).toBe("none")
    expect(runFix(AddOutput, e.fix).stack.auth).toBe("better-auth")
    expect(readFileSync(dashboard, "utf8")).not.toContain("// mine")
  })

  it("add can't swap a choice, and says there is no fix", () => {
    const e = failure(["add", "database/postgres", "--json", "--cwd", "app"])
    expect(e).toMatchObject({ code: "SlotAlreadySet", current: "d1", fix: null })
  })

  it("without --json, a prompt it can't show fails at once, names the fix and prints no chrome", () => {
    const r = efforge(["create", "asks", "--dry-run"])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`No terminal to ask for "preset"`)
    expect(r.stderr).toContain("Try: npx -y create-efforge create asks --dry-run --yes")
    expect(`${r.stdout}${r.stderr}`).not.toContain("◇")
    const fixed = efforge(parseFix("npx -y create-efforge create asks --dry-run --yes", work).args)
    expect(fixed.status).toBe(0)
  })

  it("interrupted under --json: one document with what was written and how to finish", async () => {
    const stubs = join(work, ".slow")
    mkdirSync(stubs, { recursive: true })
    writeFileSync(
      join(stubs, "pnpm"),
      '#!/bin/sh\nif [ "$1" = install ]; then exec sleep 30; fi\nexit 0\n',
    )
    chmodSync(join(stubs, "pnpm"), 0o755)
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const name = `stopped-${signal.toLowerCase()}`
      const child = spawn(process.execPath, [bin, "create", name, "--json", "--database=d1"], {
        cwd: work,
        env: { ...env, PATH: `${stubs}${delimiter}${env.PATH ?? ""}` },
        stdio: ["ignore", "pipe", "pipe"],
      })
      let stdout = ""
      let stderr = ""
      child.stdout.on("data", (d: Buffer) => (stdout += String(d)))
      child.stderr.on("data", (d: Buffer) => (stderr += String(d)))
      const exited = new Promise<number | null>((done) => child.on("close", (code) => done(code)))
      // wait until the files are written and the install is running
      const deadline = Date.now() + 30_000
      while (!existsSync(join(work, name, ".git")) && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 100))
      await new Promise((r) => setTimeout(r, 500))
      child.kill(signal)
      expect(await exited).toBe(130)
      expect(stderr).toBe("")
      const doc = JSON.parse(stdout)
      Schema.decodeUnknownSync(ErrorOutput)(doc)
      expect(doc.error).toMatchObject({ code: "Interrupted", written: true })
      expect(doc.error.remaining[0]).toBe("pnpm install --no-frozen-lockfile")
      expect(doc.error.fix).toBe(`cd ${name} && ${doc.error.remaining.join(" && ")}`)
      expect(doc.error.nextSteps.map((x: { command: string }) => x.command)).toEqual([
        ...doc.error.remaining,
        "pnpm db:migrate",
        "pnpm dev",
      ])
      expect(doc.error.env.length).toBeGreaterThan(0)
      // the same command again: no second project, the steps that finish this one
      const again = failure(["create", name, "--json", "--database=d1"])
      expect(again).toMatchObject({ code: "TargetNotEmpty", project: true, fix: doc.error.fix })
    }
  })

  it("a failed install in add: the document has the env and next steps, and a re-run installs", () => {
    ok(CreateOutput, ["create", "noinst", "--json", "--database=none", "--no-git"])
    const stubs = join(work, ".failing")
    mkdirSync(stubs, { recursive: true })
    writeFileSync(
      join(stubs, "pnpm"),
      '#!/bin/sh\nif [ "$1" = install ]; then echo "ERR_PNPM_FETCH_404" >&2; exit 1; fi\nexit 0\n',
    )
    chmodSync(join(stubs, "pnpm"), 0o755)
    const failing = { ...env, PATH: `${stubs}${delimiter}${env.PATH ?? ""}` }
    const args = ["add", "database/d1", "orm/effect-sql", "auth/better-auth", "--json"]
    const r = spawnSync(process.execPath, [bin, ...args, "--cwd", "noinst"], {
      cwd: work,
      env: failing,
      encoding: "utf8",
    })
    expect(r.status).toBe(1)
    const e = json(r).error as Record<string, unknown>
    expect(e).toMatchObject({ code: "CommandFailed", failed: "pnpm install --no-frozen-lockfile" })
    expect(e.fix).toBe("cd noinst && pnpm install --no-frozen-lockfile")
    expect((e.env as Array<{ name: string }>).map((v) => v.name)).toContain("BETTER_AUTH_SECRET")
    expect((e.nextSteps as Array<{ command: string }>).map((x) => x.command)).toEqual([
      "pnpm install --no-frozen-lockfile",
      "pnpm db:migrate",
    ])
    expect(e.created).toBeDefined()
    expect(e.changed).toBeDefined()

    // the same add again, install still failing: it still owes the install, not "all is well"
    const stillFailing = spawnSync(process.execPath, [bin, ...args, "--cwd", "noinst"], {
      cwd: work,
      env: failing,
      encoding: "utf8",
    })
    expect(stillFailing.status).toBe(1)
    expect((json(stillFailing).error as { code: string }).code).toBe("CommandFailed")
    // without an install it says one is owed
    const owed = ok(AddOutput, [...args, "--no-install", "--cwd", "noinst"])
    expect(owed.nextSteps.map((x) => x.command)).toEqual([
      "pnpm install --no-frozen-lockfile",
      "pnpm db:migrate",
    ])
    expect(owed.warnings.join(" ")).toContain("install didn't finish")
    // and with pnpm working again, the re-run finishes the job
    const done = ok(AddOutput, [...args, "--cwd", "noinst"])
    expect(done).toMatchObject({ installed: true, added: [] })
    expect(done.nextSteps.map((x) => x.command)).toEqual(["pnpm db:migrate"])
    const quiet = ok(AddOutput, [...args, "--cwd", "noinst"])
    expect(quiet).toMatchObject({ installed: false, nextSteps: [], warnings: [] })
  })

  it("an interrupted add --json prints one document with the files and the install it owes", async () => {
    ok(CreateOutput, ["create", "stopadd", "--json", "--database=d1", "--no-git"])
    const stubs = join(work, ".slow-add")
    mkdirSync(stubs, { recursive: true })
    writeFileSync(
      join(stubs, "pnpm"),
      '#!/bin/sh\nif [ "$1" = install ]; then exec sleep 30; fi\nexit 0\n',
    )
    chmodSync(join(stubs, "pnpm"), 0o755)
    const child = spawn(process.execPath, [bin, "add", "ai", "--json", "--cwd", "stopadd"], {
      cwd: work,
      env: { ...env, PATH: `${stubs}${delimiter}${env.PATH ?? ""}` },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d: Buffer) => (stdout += String(d)))
    child.stderr.on("data", (d: Buffer) => (stderr += String(d)))
    const exited = new Promise<number | null>((done) => child.on("close", (code) => done(code)))
    // wait until the files are written and the install is running
    const deadline = Date.now() + 30_000
    while (manifest(join(work, "stopadd")).stack.ai === "none" && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => setTimeout(r, 500))
    child.kill("SIGINT")
    expect(await exited).toBe(130)
    expect(stderr).toBe("")
    const doc = JSON.parse(stdout)
    Schema.decodeUnknownSync(ErrorOutput)(doc)
    expect(doc.error).toMatchObject({
      code: "Interrupted",
      written: true,
      remaining: ["pnpm install --no-frozen-lockfile"],
      fix: "cd stopadd && pnpm install --no-frozen-lockfile",
    })
    expect(doc.error.added.map((a: { id: string }) => a.id)).toEqual(["ai/effect-ai-byok"])
    expect(doc.error.env.length).toBeGreaterThan(0)
    expect(doc.error.changed).toContain("apps/web/package.json")
  })

  it("the bare root form inside a project creates nothing; create <name> still does", () => {
    const inside = join(work, "app")
    for (const args of [
      ["update", "--json", "--no-install", "--no-git"],
      ["--json"],
      ["thing", "--json"],
    ]) {
      const e = failure(args, inside)
      expect(e.fix, args.join(" ")).toBeNull()
      expect(["UnknownCommand", "InsideProject"]).toContain(e.code)
    }
    expect(failure(["thing", "--json"], inside)).toMatchObject({
      code: "InsideProject",
      project: inside,
    })
    expect(existsSync(join(inside, "update"))).toBe(false)
    expect(existsSync(join(inside, "my-app"))).toBe(false)
    expect(ok(CreateOutput, ["create", "nested", "--json", "--dry-run"], inside).directory).toBe(
      join(inside, "nested"),
    )
  })

  it("list from inside a project names it in nearby", () => {
    const inside = join(work, "app", "apps", "web")
    const listed = ok(ListOutput, ["list", "--json"], inside)
    expect(listed).toMatchObject({ project: false, nearby: join(work, "app") })
    const text = efforge(["list"], inside)
    expect(text.stdout).toContain(`${join(work, "app")} is`)
  })

  it("a project with another stack in the directory: no fix, both stacks as data", () => {
    const e = failure(["create", "app", "--json", "--database=postgres", "--extras=email"])
    expect(e).toMatchObject({ code: "TargetNotEmpty", project: true, fix: null })
    expect((e.stack as { database: string }).database).toBe("d1")
    expect((e.requested as { database: string }).database).toBe("postgres")
  })

  it("in a pipe, list prints the list and nothing else", () => {
    const r = efforge(["list"])
    expect(r.status).toBe(0)
    expect(r.stdout).not.toMatch(/^efforge \d/m)
    expect(r.stdout.split("\n")[0]).toBe("Database")
    expect(r.stdout).toContain("extras/email")
  })

  it("--completions covers both bin names", () => {
    for (const [shell, line] of [
      ["bash", "complete -F _create_efforge efforge"],
      ["zsh", "#compdef create-efforge efforge"],
      ["fish", "complete -c efforge --wraps create-efforge"],
    ] as const) {
      const r = efforge(["--completions", shell])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain(line)
    }
  })
})
