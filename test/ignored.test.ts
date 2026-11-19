import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, expect, it } from "vitest"
import { ignoredBy } from "../src/ignored.ts"

// A project made with --no-git under a repository whose .gitignore ignores everything: pnpm check
// sees no files and Tailwind styles nothing. create says so, as a warning under --json, and doctor
// has a check for it.

const bin = new URL("../src/bin.ts", import.meta.url).pathname
const work = realpathSync(mkdtempSync(join(tmpdir(), "efforge-ignored-")))
afterAll(() => rmSync(work, { recursive: true, force: true }))

const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" })
const efforge = (cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    timeout: 60_000,
  })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

/** A repository that ignores everything, like a dotfiles repo in ~ with `*`. */
const ignoringRepo = (name: string) => {
  const dir = join(work, name)
  mkdirSync(dir)
  git(dir, "init", "-q")
  writeFileSync(join(dir, ".gitignore"), "*\n")
  return dir
}

it(
  "create --no-git under a .gitignore that ignores everything warns, with what to run",
  { timeout: 120_000 },
  () => {
    const home = ignoringRepo("home")
    const rule = `* in ${join(home, ".gitignore")}`
    const json = efforge(home, "create", "app", "--json", "--no-git", "--no-install")
    const doc = JSON.parse(json.out)
    expect(doc.ok).toBe(true)
    expect(doc.warnings).toEqual([
      `./app is ignored by git (the rule ${rule}), so pnpm check sees no files and Tailwind styles nothing. Run cd app && git init to give it its own ignore rules.`,
    ])
    const text = efforge(home, "create", "app2", "--yes", "--no-git", "--no-install")
    expect(text.code).toBe(0)
    expect(text.out.replace(/\s+/g, " ")).toContain("Run cd app2 && git init")

    // doctor: the check fails with the fix, and passes after it
    const before = JSON.parse(efforge(home, "doctor", "--json", "--cwd", "app").out)
    const check = before.checks.find((c: { id: string }) => c.id === "ignored")
    expect(check).toMatchObject({ status: "fail", fix: "cd app && git init", details: { rule } })
    git(join(home, "app"), "init", "-q")
    const after = JSON.parse(efforge(home, "doctor", "--json", "--cwd", "app").out)
    expect(after.checks.find((c: { id: string }) => c.id === "ignored")?.status).toBe("ok")
  },
)

it("a project git doesn't ignore gets no warning", { timeout: 60_000 }, () => {
  const plain = join(work, "plain")
  mkdirSync(plain)
  git(plain, "init", "-q")
  writeFileSync(join(plain, ".gitignore"), "node_modules\n")
  const doc = JSON.parse(efforge(plain, "create", "app", "--json", "--no-git", "--no-install").out)
  expect(doc.warnings).toEqual([])
  // outside any repository, and in a project that is its own, git ignores nothing
  expect(ignoredBy(join(work, "nowhere", "app"))).toBeUndefined()
  const home = ignoringRepo("home2")
  mkdirSync(join(home, "own"))
  git(join(home, "own"), "init", "-q")
  expect(ignoredBy(join(home, "own"))).toBeUndefined()
  expect(ignoredBy(join(home, "not-yet"))).toBe(`* in ${join(home, ".gitignore")}`)
  // a negation that lets the project back in
  writeFileSync(join(home, ".gitignore"), "*\n!not-yet/\n!not-yet/**\n")
  expect(ignoredBy(join(home, "not-yet"))).toBeUndefined()
})
