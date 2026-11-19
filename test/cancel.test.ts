import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { afterEach, beforeEach, expect, it, vi } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { runWith } from "../src/cli.ts"
import { TemplatesDir } from "../src/commands/create.ts"
import { CUSTOM } from "../src/prompts/flow.ts"
import { type Answer, CANCEL, scriptedPromptIO, type Shown } from "../src/prompts/navigable.ts"
import { slots } from "../src/slots.ts"
import { recordingSpawner } from "./recordingSpawner.ts"

// Every prompt the CLI has, found in the source, is cancelled once: each must exit 130 with
// "Cancelled. Nothing written." and leave the disk as it was. A new prompt that no scenario below
// reaches fails the first test, so it can't ship without this check.

const src = new URL("../src", import.meta.url).pathname
const templates = new URL("../templates", import.meta.url).pathname

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? sources(p) : p.endsWith(".ts") ? [p] : []
  })

/** The id of every prompt call in src/, by where it is; `slot.id` stands for each prompted slot. */
const promptsInSource = (): Map<string, string> => {
  const found = new Map<string, string>()
  const prompted = slots.filter((s) => s.options.length > 1).map((s) => s.id)
  for (const file of sources(src)) {
    if (file.endsWith("prompts/navigable.ts")) continue
    const text = readFileSync(file, "utf8")
    for (const m of text.matchAll(
      /\bio\.(select|multiselect|text|confirm)\(\{\s*id:\s*([^,\n]+),/g,
    )) {
      const where = `${relative(src, file)}:${text.slice(0, m.index).split("\n").length}`
      const expr = (m[2] as string).trim()
      const literal = /^"([^"]+)"$/.exec(expr)?.[1]
      if (literal !== undefined) found.set(literal, where)
      else if (expr === "slot.id") for (const id of prompted) found.set(id, where)
      else throw new Error(`${where}: a prompt id this test can't read (${expr}); use a literal`)
    }
  }
  return found
}

let cwd: string
let tmp: string
beforeEach(() => {
  cwd = process.cwd()
  tmp = mkdtempSync(join(tmpdir(), "efforge-cancel-"))
  process.chdir(tmp)
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  process.exitCode = undefined
})
afterEach(() => {
  vi.restoreAllMocks()
  process.chdir(cwd)
  rmSync(tmp, { recursive: true, force: true })
  process.exitCode = undefined
})

const run = async (args: string[], answer: (s: Shown) => Answer) => {
  const s = scriptedPromptIO(answer)
  await runWith(args).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        s.layer,
        Layer.succeed(TemplatesDir, templates),
        recordingSpawner([]),
      ),
    ),
    Effect.runPromise,
  )
  const exitCode = process.exitCode ?? 0
  process.exitCode = undefined
  return { ...s, exitCode }
}

/** Every file under `dir` with its contents, to see that nothing changed. */
const snapshot = (dir: string): Record<string, string> =>
  Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => {
        const p = join(d.parentPath, d.name)
        return [relative(dir, p), readFileSync(p, "utf8")]
      }),
  )

/** An answer that walks on: the first option, nothing in a multiselect, yes to confirm. */
const walkOn = (s: Shown): Answer =>
  s.kind === "text"
    ? "app"
    : s.kind === "confirm"
      ? true
      : s.kind === "multiselect"
        ? []
        : s.id === "preset"
          ? CUSTOM
          : (s.options[0] as string)

/** Each way a person meets prompts: the command, run in `dir` (made by `setup`). */
const scenarios: ReadonlyArray<{
  readonly name: string
  readonly args: string[]
  readonly setup?: () => Promise<unknown>
}> = [
  { name: "create, choosing each part", args: ["--no-install", "--no-git"] },
  {
    name: "add with no ids, in a project without auth",
    args: ["add", "--cwd", "app", "--no-install"],
    setup: () =>
      run(["create", "app", "--json", "--no-install", "--no-git", "--database=none"], walkOn),
  },
]

it("cancelling at any prompt exits 130, says nothing was written, and writes nothing", async () => {
  const expected = promptsInSource()
  expect([...expected.keys()].length).toBeGreaterThan(3)
  const reached = new Set<string>()
  for (const sc of scenarios) {
    const dir = mkdtempSync(join(tmp, "case-"))
    process.chdir(dir)
    await sc.setup?.()
    // walk every prompt once, cancelling at the last so nothing is written
    const walk = await run(sc.args, (s) => (s.kind === "confirm" ? CANCEL : walkOn(s)))
    const ids = [...new Set(walk.shown.map((s) => s.id))]
    expect(ids.length, sc.name).toBeGreaterThan(0)
    for (const target of ids) {
      reached.add(target)
      const before = snapshot(dir)
      const r = await run(sc.args, (s) => (s.id === target ? CANCEL : walkOn(s)))
      expect(r.exitCode, `${sc.name}, cancelled at ${target}`).toBe(130)
      expect(r.output.at(-1), `${sc.name}, cancelled at ${target}`).toBe(
        "outro: Cancelled. Nothing written.",
      )
      expect(snapshot(dir), `${sc.name}, cancelled at ${target}`).toEqual(before)
    }
    process.chdir(tmp)
  }
  const missed = [...expected].filter(([id]) => !reached.has(id))
  expect(missed, "prompts no scenario reaches: add one to `scenarios`").toEqual([])
})

it("finds the prompts in the source", () => {
  const ids = [...promptsInSource().keys()]
  for (const id of ["name", "preset", "database", "extras", "confirm", "addons"])
    expect(ids).toContain(id)
})
