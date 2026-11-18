import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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
  writeFileSync(join(stubs, "pnpm"), "#!/bin/sh\nexit 0\n")
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
      expect(tokens.slice(0, 2)).toEqual(["npx", "create-efforge"])
      args = tokens.slice(2)
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
    expect(e.fix).toBe("npx create-efforge create typo --json --dry-run --database=d1")
    expect(runFix(CreateOutput, e.fix).stack.database).toBe("d1")
  })

  it("a mistyped command doesn't create a project named after it", () => {
    const e = failure(["lst", "--json"])
    expect(e.code).toBe("UnknownCommand")
    expect(existsSync(join(work, "lst"))).toBe(false)
    expect(runFix(ListOutput, e.fix).addons.length).toBeGreaterThan(0)
  })

  it("an unknown value and incompatible choices: fix picks a valid one", () => {
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
    expect(conflict.code).toBe("IncompatibleStack")
    expect(runFix(CreateOutput, conflict.fix).stack).toMatchObject({
      database: "none",
      auth: "none",
    })
  })

  it("an invalid project name: fix uses a valid one", () => {
    const e = failure(["create", "My App", "--json", "--dry-run"])
    expect(e.code).toBe("InvalidProjectName")
    expect(runFix(CreateOutput, e.fix).stack.name).toBe("my-app")
  })

  it("a directory that isn't empty: fix uses a free name", () => {
    mkdirSync(join(work, "taken"))
    writeFileSync(join(work, "taken", "notes.txt"), "mine")
    const e = failure(["create", "taken", "--json", "--no-git"])
    expect(e.code).toBe("TargetNotEmpty")
    expect(e.fix).toBe("npx create-efforge create taken-2 --json --no-git")
    expect(runFix(CreateOutput, e.fix).directory).toBe(join(work, "taken-2"))
    expect(readFileSync(join(work, "taken", "notes.txt"), "utf8")).toBe("mine")
  })

  it("an unknown add-on id: fix uses the one suggestion", () => {
    const e = failure(["add", "storag", "--json", "--cwd", "app", "--dry-run"])
    expect(e.code).toBe("UnknownAddon")
    expect(e.suggestions).toEqual(["extras/storage"])
    expect(runFix(AddOutput, e.fix).added.map((a) => a.id)).toEqual(["extras/storage"])
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

  it("add that needs other add-ons: fix adds them in the same command", () => {
    ok(CreateOutput, ["create", "nodb", "--json", "--database=none", "--no-git"])
    const e = failure(["add", "auth/better-auth", "--json", "--dry-run", "--cwd", "nodb"])
    expect(e.code).toBe("IncompatibleStack")
    expect(e.needs).toEqual(["database/d1", "orm/effect-sql"])
    expect(runFix(AddOutput, e.fix).stack).toMatchObject({
      database: "d1",
      orm: "effect-sql",
      auth: "better-auth",
    })
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
    const dashboard = join(work, "edited", "apps/web/src/routes/app/index.tsx")
    writeFileSync(dashboard, `${readFileSync(dashboard, "utf8")}// mine\n`)
    const e = failure(["add", "auth/better-auth", "--json", "--cwd", "edited"])
    expect(e.code).toBe("OverlayConflict")
    expect(e.files).toEqual(["apps/web/src/routes/app/index.tsx"])
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
    expect(r.stderr).toContain(`No terminal to ask for "database"`)
    expect(r.stderr).toContain("Try: npx create-efforge create asks --dry-run --yes")
    expect(`${r.stdout}${r.stderr}`).not.toContain("◇")
    const fixed = efforge(parseFix("npx create-efforge create asks --dry-run --yes", work).args)
    expect(fixed.status).toBe(0)
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
