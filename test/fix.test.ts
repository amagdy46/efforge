import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  addonSuggestions,
  alternative,
  commandLine,
  finish,
  fix,
  intentOf,
  meantName,
  render,
  spelledOut,
  withFlag,
} from "../src/fix.ts"

// The one place fixes are built. Each rule of "`fix` is a promise" (docs/json.md) refuses a
// candidate here, whatever the error that proposed it.

let dir: string
let before: string
beforeEach(() => {
  before = process.cwd()
  dir = mkdtempSync(join(tmpdir(), "efforge-fix-"))
  process.chdir(dir)
})
afterEach(() => {
  process.chdir(before)
  rmSync(dir, { recursive: true, force: true })
})

const project = (name: string) => {
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, "efforge.jsonc"), "{}")
}

describe("intent", () => {
  it("reads the command, its words and flags, with -- understood", () => {
    expect(intentOf(["add", "--json", "--", "email"])).toMatchObject({
      verb: "add",
      word: "add",
      operands: ["email"],
    })
    expect(intentOf(["--json", "lst"])).toMatchObject({ verb: "list", word: "lst" })
    expect(intentOf(["CREATE", "--json"])).toMatchObject({ verb: "create", word: "CREATE" })
    expect(intentOf(["my-app", "--json"])).toMatchObject({ verb: "create", word: undefined })
    // a word kept for commands is no command at all
    expect(intentOf(["update", "--json"]).verb).toBeUndefined()
  })

  it("renders the command first, the words, the flags, and only then --", () => {
    expect(render(intentOf(["--cwd", "app", "add", "email", "--json"]))).toEqual([
      "add",
      "email",
      "--cwd",
      "app",
      "--json",
    ])
    expect(render(withFlag(intentOf(["add", "--json", "--", "-x"]), "cwd", "app"))).toEqual([
      "add",
      "--json",
      "--cwd=app",
      "--",
      "-x",
    ])
  })

  it("commandLine adds --yes to a create that would prompt, before any --", () => {
    expect(commandLine(["create", "a"])).toBe("npx -y create-efforge create a --yes")
    expect(commandLine(["create", "--", "a"])).toBe("npx -y create-efforge create --yes -- a")
    expect(commandLine(["create", "a", "--json=false"])).toBe(
      "npx -y create-efforge create a --json=false --yes",
    )
    expect(commandLine(["create", "a", "--json"])).toBe("npx -y create-efforge create a --json")
  })
})

describe("fix refuses what the caller didn't ask for", () => {
  it("a different command, or a create for anything else", () => {
    expect(
      fix(["add", "email", "--json"], (i) => ({ ...i, verb: "create", word: "create" })),
    ).toBeNull()
    expect(fix(["update", "--json"], (i) => i)).toBeNull()
    expect(fix(["lst", "--json"], spelledOut)).toBe("npx -y create-efforge list --json")
  })

  it("another name, a path made a name, an invented name", () => {
    const rename = (to: string) => (i: ReturnType<typeof intentOf>) => ({ ...i, operands: [to] })
    expect(fix(["create", "../escape", "--json"], rename("escape"))).toBeNull()
    expect(fix(["create", "", "--json"], rename("my-app"))).toBeNull()
    expect(fix(["create", "a", "--json"], rename("b"))).toBeNull()
    expect(fix(["create", "--json"], rename("my-app"))).toBeNull()
    expect(fix(["create", "My App", "--json"], rename("my-app"))).toBe(
      "npx -y create-efforge create my-app --json",
    )
    expect(meantName("../escape")).toBeUndefined()
    expect(meantName("a/b")).toBeUndefined()
    expect(meantName("@Scope/My App")).toBe("@scope/my-app")
  })

  it("a dropped or changed choice", () => {
    const base = ["create", "a", "--json", "--no-install", "--no-git", "--dry-run"]
    for (const name of ["install", "git", "dry-run"])
      expect(
        fix(base, (i) => withFlag(i, name, null)),
        name,
      ).toBeNull()
    // a value only by the typo rule
    expect(
      fix(["create", "a", "--database=mysql"], (i) => withFlag(i, "database", "postgres")),
    ).toBeNull()
    expect(
      fix(["create", "a", "--database=postgress"], (i) => withFlag(i, "database", "postgres")),
    ).toBe("npx -y create-efforge create a --database=postgres --yes")
    // an unknown flag that means nothing can't be dropped
    expect(fix(["create", "a", "--with-stripe"], (i) => ({ ...i, flags: [] }))).toBeNull()
  })

  it("a value for a flag that can't take it", () => {
    expect(
      fix(["--completions=nushell", "--json"], (i) => withFlag(i, "completions", null)),
    ).toBeNull()
    expect(fix(["create", "a", "--install=maybe"], (i) => withFlag(i, "install", true))).toBeNull()
  })

  it("another add-on, or another project directory unless the error allows it", () => {
    expect(fix(["add", "r2", "--json"], (i) => ({ ...i, operands: ["database/d1"] }))).toBeNull()
    expect(fix(["add", "emial", "--json"], (i) => ({ ...i, operands: ["extras/email"] }))).toBe(
      "npx -y create-efforge add extras/email --json",
    )
    expect(addonSuggestions("stor")).toEqual(["extras/storage"])
    project("app")
    expect(fix(["add", "email", "--json"], (i) => withFlag(i, "cwd", "app"))).toBeNull()
    expect(fix(["add", "email", "--json"], (i) => withFlag(i, "cwd", "app"), { cwd: true })).toBe(
      "npx -y create-efforge add email --json --cwd=app",
    )
    // and only to a directory that holds a project
    expect(fix(["add", "email"], (i) => withFlag(i, "cwd", "nope"), { cwd: true })).toBeNull()
  })

  it("the command the caller ran, again", () => {
    expect(fix(["add", "email", "--json"], (i) => i)).toBeNull()
    expect(fix(["add", "email", "--json"], (i) => i, { again: true })).toBe(
      "npx -y create-efforge add email --json",
    )
  })

  it("a root-form create inside a project", () => {
    project("app")
    process.chdir(join(dir, "app"))
    expect(fix(["x", "--databse=d1"], (i) => i)).toBeNull()
    expect(alternative(["x", "--json"], (i) => i)).toBeNull()
  })
})

describe("finish", () => {
  const steps = [
    "pnpm install --no-frozen-lockfile",
    "pnpm format",
    "git add -A && git commit -m 'Initial commit'",
  ]

  it("leaves out what the caller turned off, and is null when nothing is left", () => {
    expect(finish(["create", "a", "--json"], join(dir, "a"), steps)).toBe(
      `cd a && ${steps.join(" && ")}`,
    )
    expect(finish(["create", "a", "--no-install"], join(dir, "a"), steps)).toBe(
      `cd a && ${steps[2]}`,
    )
    expect(finish(["create", "a", "--no-install", "--no-git"], join(dir, "a"), steps)).toBeNull()
    expect(finish(["create", "a", "--dry-run"], join(dir, "a"), steps)).toBeNull()
    expect(finish(["list"], dir, steps)).toBeNull()
  })
})
