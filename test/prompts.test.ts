import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { PassThrough, Writable } from "node:stream"
import { stripVTControlCharacters } from "node:util"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { afterEach, beforeEach, expect, it, vi } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { runWith } from "../src/cli.ts"
import { TemplatesDir } from "../src/commands/create.ts"
import { CUSTOM } from "../src/prompts/flow.ts"
import {
  type Answer,
  CANCEL,
  clack,
  isCommandLine,
  PromptIO,
  type PromptIOShape,
  scriptedPromptIO,
  type Shown,
} from "../src/prompts/navigable.ts"
import { slots } from "../src/slots.ts"
import { recordingSpawner } from "./recordingSpawner.ts"

// Every prompt the CLI has, found in the source, is cancelled once: each must exit 130 with
// "Cancelled. Nothing written." and leave the disk as it was. A new prompt that no scenario below
// reaches fails the first test, so it can't ship without this check. Then each is drawn by clack,
// as a terminal shows it, and every line of it and of the output around it must fit 80 columns.

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

const run = async (
  args: string[],
  answer: (s: Shown) => Answer,
  wrap: (io: PromptIOShape) => PromptIOShape = (io) => io,
) => {
  const s = scriptedPromptIO(answer)
  await runWith(args).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.effect(
          PromptIO,
          Effect.gen(function* () {
            return wrap(yield* PromptIO)
          }),
        ).pipe(Layer.provide(s.layer)),
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

/** An answer that walks on: the first option, nothing in a multiselect, the default. */
const walkOn = (s: Shown): Answer =>
  s.kind === "text"
    ? "app"
    : s.kind === "confirm"
      ? true
      : s.kind === "multiselect"
        ? []
        : s.id === "preset"
          ? CUSTOM
          : ((s.initial as string | undefined) ?? (s.options[0] as string))

/**
 * Each way a person meets prompts: the command, run in a directory `setup` prepared, answered by
 * `answer` (given the prompts so far) to the end without writing anything.
 */
const scenarios: ReadonlyArray<{
  readonly name: string
  readonly args: string[]
  readonly answer: (s: Shown, before: ReadonlyArray<Shown>) => Answer
  readonly setup?: () => Promise<unknown>
}> = [
  {
    name: "create, choosing each part",
    args: ["--no-install", "--no-git"],
    answer: (s) => (s.id === "confirm" ? false : walkOn(s)),
  },
  {
    name: "create from a preset, then changing parts",
    args: ["--no-install", "--no-git"],
    answer: (s, before) =>
      s.id === "preset"
        ? "saas"
        : s.id === "confirm"
          ? before.some((x) => x.id === "confirm")
            ? "no"
            : "change"
          : walkOn(s),
  },
  {
    name: "add with no ids, in a project without auth",
    args: ["add", "--cwd", "app", "--no-install"],
    answer: walkOn,
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
    const before = snapshot(dir)
    // walk every prompt once, to its end, writing nothing
    const shown: Shown[] = []
    const walk = await run(sc.args, (s) => {
      const a = sc.answer(s, shown)
      shown.push(s)
      return a
    })
    expect(walk.exitCode, sc.name).toBe(0)
    expect(snapshot(dir), sc.name).toEqual(before)
    // then cancel at each, the first time it shows
    for (const [at, target] of walk.shown.entries()) {
      if (walk.shown.findIndex((x) => x.id === target.id) !== at) continue
      reached.add(target.id)
      const seen: Shown[] = []
      const r = await run(sc.args, (s) => {
        const a = seen.length === at ? CANCEL : sc.answer(s, seen)
        seen.push(s)
        return a
      })
      const what = `${sc.name}, cancelled at ${target.id}`
      expect(r.shown.at(-1)?.id, what).toBe(target.id)
      expect(r.exitCode, what).toBe(130)
      expect(r.output.at(-1), what).toBe("outro: Cancelled. Nothing written.")
      expect(snapshot(dir), what).toEqual(before)
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

/** What clack prints for `draw`, without colours, on a terminal `columns` wide. */
const drawn = async (
  draw: (c: ReturnType<typeof clack>) => unknown,
  columns: number,
): Promise<string[]> => {
  const chunks: string[] = []
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        chunks.push(String(chunk))
        done()
      },
    }),
    { columns, rows: 100 },
  )
  const stop = new AbortController()
  const shown = draw(clack({ output, input: new PassThrough(), signal: stop.signal }))
  stop.abort()
  await shown
  return stripVTControlCharacters(chunks.join(""))
    .split("\n")
    .map((l) => l.trimEnd())
}

it("every prompt, and the output around it, fits 80 columns", async () => {
  const COLUMNS = 80
  const wide: string[] = []
  const frames: Array<Promise<void>> = []
  // Prompts and notes are drawn on a wide terminal, so clack wraps nothing for us: a line past 80
  // would wrap on an 80-column one. Log lines and the outro are drawn at 80: clack never wraps
  // them, efforge does. A command alone on its line is the one exception: it is never broken.
  const check = (what: string, draw: (c: ReturnType<typeof clack>) => unknown, columns = 400) =>
    frames.push(
      drawn(draw, columns).then((lines) => {
        for (const l of lines)
          if ([...l].length > COLUMNS && !isCommandLine(l.replace(/^[│└●▲◇■]?\s*/, "")))
            wide.push(`${what}: ${l}`)
      }),
    )
  const drawing = (io: PromptIOShape): PromptIOShape => ({
    ...io,
    // the cursor on each option in turn: its hint shows only there
    select: (o) => {
      for (const c of o.options) check(`select ${o.id} at ${c.value}`, (x) => x.select(o, c.value))
      return io.select(o)
    },
    multiselect: (o) => {
      for (const c of o.options)
        check(`multiselect ${o.id} at ${c.value}`, (x) => x.multiselect(o, c.value))
      return io.multiselect(o)
    },
    text: (o) => {
      check(`text ${o.id}`, (x) => x.text(o))
      return io.text(o)
    },
    confirm: (o) => {
      check(`confirm ${o.id}`, (x) => x.confirm(o))
      return io.confirm(o)
    },
    intro: (t) => {
      check("intro", (x) => x.intro(t), COLUMNS)
      return io.intro(t)
    },
    info: (m) => {
      check("info", (x) => x.info(m), COLUMNS)
      return io.info(m)
    },
    warn: (m) => {
      check("warn", (x) => x.warn(m), COLUMNS)
      return io.warn(m)
    },
    note: (b, t) => {
      check(`note ${t}`, (x) => x.note(b, t))
      return io.note(b, t)
    },
    outro: (m) => {
      check("outro", (x) => x.outro(m), COLUMNS)
      return io.outro(m)
    },
  })
  const kinds = new Set<string>()
  // the prompts, then runs that finish: a create that writes, a dry run, a preset that gives
  // way, an add from the picker
  const finishing: typeof scenarios = [
    {
      name: "create from a preset, written",
      args: ["--no-install", "--no-git"],
      answer: (x) => (x.id === "preset" ? "saas" : x.id === "confirm" ? "yes" : walkOn(x)),
    },
    {
      name: "a dry run beside a preset that gives way",
      args: ["app", "--dry-run", "--preset=saas", "--database=none"],
      answer: walkOn,
    },
    {
      name: "add from the picker",
      args: ["add", "--cwd", "app", "--no-install"],
      answer: (x) => (x.id === "addons" ? ["extras/realtime", "infra/alchemy"] : walkOn(x)),
      setup: () =>
        run(["create", "app", "--json", "--no-install", "--no-git", "--preset=ai"], walkOn),
    },
  ]
  for (const sc of [...scenarios, ...finishing]) {
    const dir = mkdtempSync(join(tmp, "case-"))
    process.chdir(dir)
    await sc.setup?.()
    const shown: Shown[] = []
    const r = await run(
      sc.args,
      (s) => {
        const a = sc.answer(s, shown)
        shown.push(s)
        return a
      },
      drawing,
    )
    for (const s of r.shown) kinds.add(s.id)
    process.chdir(tmp)
  }
  await Promise.all(frames)
  expect(frames.length).toBeGreaterThan(20)
  expect([...kinds]).toEqual(expect.arrayContaining(["name", "preset", "confirm", "addons"]))
  expect(wide).toEqual([])
})
