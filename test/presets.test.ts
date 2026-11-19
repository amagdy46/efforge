import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { afterEach, beforeEach, expect, it, vi } from "@effect/vitest"
import { Effect, Exit, Layer } from "effect"
import { runWith } from "../src/cli.ts"
import { TemplatesDir } from "../src/commands/create.ts"
import { askStack, presetFlags, type StackFlags } from "../src/prompts/flow.ts"
import { GoBack, PromptIO, scriptedPromptIO } from "../src/prompts/navigable.ts"
import { presets } from "../src/presets.ts"
import { validate } from "../src/rules.ts"
import { slots } from "../src/slots.ts"
import { toCommand } from "../src/stack.ts"

const run = (
  flags: Parameters<typeof askStack>[0],
  answers: Parameters<typeof scriptedPromptIO>[0],
  yes = false,
) => {
  const s = scriptedPromptIO(answers)
  const result = Effect.gen(function* () {
    const io = yield* PromptIO
    return yield* askStack(flags, io, { yes })
  }).pipe(Effect.provide(s.layer))
  return { s, result }
}

it("every preset is a valid stack, and none is the stack another preset already is", () => {
  for (const p of presets)
    expect(Exit.isSuccess(Effect.runSyncExit(validate({ name: "app", ...p.stack })))).toBe(true)
  const seen = new Set(presets.map((p) => JSON.stringify(p.stack)))
  expect(seen.size).toBe(presets.length)
})

it.effect("--preset fills every slot without prompting", () =>
  Effect.gen(function* () {
    for (const p of presets) {
      const { s, result } = run({ name: "app", preset: p.id }, [])
      expect(yield* result).toEqual({ name: "app", ...p.stack })
      expect(s.shown).toEqual([])
    }
  }),
)

it.effect(
  "a slot flag beside --preset overrides that slot; the preset gives way where it must",
  () =>
    Effect.gen(function* () {
      const d1 = yield* run({ name: "app", preset: "saas", database: "d1" }, []).result
      expect(d1).toMatchObject({ database: "d1", orm: "drizzle", auth: "better-auth-orgs" })
      expect(d1.extras).toEqual(["storage", "email"])
      // no database: the preset's ORM and auth can't stay, so they take what is left
      const none = yield* run({ name: "app", preset: "saas", database: "none" }, []).result
      expect(none).toMatchObject({ database: "none", orm: "none", auth: "none" })
      const extras = yield* run({ name: "app", preset: "ai", extras: ["workflows"] }, []).result
      expect(extras).toMatchObject({ ai: "effect-ai-byok", extras: ["workflows"] })
    }),
)

it.effect("an unknown --preset fails with the list", () =>
  Effect.gen(function* () {
    const e = yield* run({ name: "app", preset: "sass" }, []).result.pipe(Effect.flip)
    expect(e).toMatchObject({
      _tag: "UnknownPreset",
      value: "sass",
      allowed: ["saas", "ai", "minimal"],
    })
  }),
)

it.effect(
  "the prompt: a preset asks nothing more; choose each part walks the slots; Back returns to it",
  () =>
    Effect.gen(function* () {
      const ai = run({}, ["app", "ai"])
      expect(yield* ai.result).toEqual({
        name: "app",
        ...(presets[1] as (typeof presets)[number]).stack,
      })
      expect(ai.s.shown.map((x) => x.id)).toEqual(["name", "preset"])
      expect(ai.s.shown[1]?.options).toEqual(["saas", "ai", "minimal", "custom"])

      const back = run({}, ["app", "custom", GoBack, "minimal"])
      expect(yield* back.result).toMatchObject({ database: "none", auth: "none", extras: [] })
      expect(back.s.shown.map((x) => x.id)).toEqual(["name", "preset", "database", "preset"])
    }),
)

it.effect("no preset prompt with --yes or once a stack flag chose a part", () =>
  Effect.gen(function* () {
    const yes = run({ name: "app" }, [], true)
    expect((yield* yes.result).database).toBe("postgres")
    expect(yes.s.shown).toEqual([])
    const flagged = run({ name: "app", database: "d1" }, ["drizzle", "none", "none", "none", []])
    yield* flagged.result
    expect(flagged.s.shown.map((x) => x.id)).not.toContain("preset")
  }),
)

it("the recorded command is the stack flag by flag, never the preset's name", () => {
  for (const p of presets) {
    const command = toCommand({ name: "app", ...p.stack })
    expect(command).not.toContain("--preset")
  }
})

// --- a preset beside flags ---------------------------------------------------------

const templates = new URL("../templates", import.meta.url).pathname
let cwd: string
let tmp: string
let logs: string[]
beforeEach(() => {
  cwd = process.cwd()
  tmp = mkdtempSync(join(tmpdir(), "efforge-presets-"))
  process.chdir(tmp)
  logs = []
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")))
  vi.spyOn(console, "error").mockImplementation(() => {})
  process.exitCode = undefined
})
afterEach(() => {
  vi.restoreAllMocks()
  process.chdir(cwd)
  rmSync(tmp, { recursive: true, force: true })
  process.exitCode = undefined
})

const createJson = async (...flags: string[]) => {
  logs = []
  await runWith(["create", "app", "--json", "--dry-run", ...flags]).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        scriptedPromptIO([]).layer,
        Layer.succeed(TemplatesDir, templates),
      ),
    ),
    Effect.runPromise,
  )
  process.exitCode = undefined
  // oxlint-disable-next-line typescript/no-explicit-any -- a JSON document, read in assertions
  return JSON.parse(logs.join("\n")) as Record<string, any>
}

it("a flag beside --preset always wins; a preset's choice it leaves no room for is dropped and said", () => {
  // every preset with every value of every slot: the flag is in the stack, or it is an error;
  // every part that isn't the preset's is the flag's, or was dropped with a message naming it
  for (const p of presets)
    for (const slot of slots)
      for (const o of slot.options) {
        const value = slot.multi ? [o.id] : o.id
        const flags = { name: "app", preset: p.id, [slot.id]: value } as StackFlags
        const dropped: string[] = []
        const exit = Effect.runSyncExit(
          Effect.gen(function* () {
            const io = yield* PromptIO
            return yield* askStack(flags, io, { yes: true, onDropped: (m) => dropped.push(m) })
          }).pipe(Effect.provide(scriptedPromptIO([]).layer)),
        )
        const what = `--preset=${p.id} --${slot.id}=${o.id}`
        if (Exit.isFailure(exit)) {
          expect(dropped, what).toEqual([])
          continue
        }
        const stack = exit.value
        expect(stack[slot.id], what).toEqual(value)
        for (const other of slots) {
          if (other.id === slot.id) continue
          const had = p.stack[other.id]
          if (JSON.stringify(stack[other.id]) === JSON.stringify(had)) continue
          expect(stack[other.id], what).toEqual(other.multi ? [] : "none")
          expect(dropped.join("\n"), what).toContain(
            `the ${p.id} preset's ${other.id}=${String(had)}`,
          )
        }
      }
})

it("--preset=saas --database=none: ok, and warnings say what was dropped", async () => {
  const doc = await createJson("--preset=saas", "--database=none")
  expect(doc.ok).toBe(true)
  expect(doc.stack).toMatchObject({ database: "none", orm: "none", auth: "none" })
  expect(doc.warnings).toEqual([
    "--database=none drops the saas preset's orm=drizzle: an ORM needs a database, and the database is none.",
    "--database=none drops the saas preset's auth=better-auth-orgs: auth stores users in the database, and the database is none.",
  ])
})

it("a flag that needs what the preset left out is an error, with complete commands", async () => {
  const auth = await createJson("--preset=minimal", "--auth=better-auth")
  expect(auth.error).toMatchObject({ code: "IncompatibleStack", flag: "--auth", fix: null })
  expect(auth.error.message).toContain("the minimal preset's database")
  const commands = (auth.error.alternatives as { command: string }[]).map((a) => a.command)
  expect(commands).toContain(
    "npx -y create-efforge create app --json --dry-run --preset=minimal --auth=better-auth --database=postgres --orm=drizzle",
  )
  expect(commands).toContain(
    "npx -y create-efforge create app --json --dry-run --preset=minimal --auth=none",
  )
  // each alternative works
  for (const c of commands) {
    const args = c.replace("npx -y create-efforge ", "").split(" ").slice(2)
    expect(
      (await createJson(...args.filter((a) => a !== "--json" && a !== "--dry-run"))).ok,
      c,
    ).toBe(true)
  }
  const d1 = await createJson("--preset=minimal", "--database=d1")
  expect(d1.error).toMatchObject({ code: "IncompatibleStack", flag: "--database", value: "d1" })
  expect(d1.error.reason).toBe("a database needs an ORM, and the minimal preset's orm is none")
  expect((d1.error.alternatives as { command: string }[]).map((a) => a.command)).toContain(
    "npx -y create-efforge create app --json --dry-run --preset=minimal --database=d1 --orm=drizzle",
  )
})

it("presetFlags: the preset, then each part that differs", () => {
  const saas = presets[0] as (typeof presets)[number]
  expect(presetFlags(saas, { name: "a", ...saas.stack })).toBe("--preset=saas")
  expect(presetFlags(saas, { name: "a", ...saas.stack, database: "d1", extras: [] })).toBe(
    "--preset=saas --database=d1 --extras=",
  )
  // the ORM and auth go with the database
  expect(
    presetFlags(saas, { name: "a", ...saas.stack, database: "none", orm: "none", auth: "none" }),
  ).toBe("--preset=saas --database=none")
})

it("a preset picked at the prompt can be changed part by part, with its parts as the defaults", async () => {
  const s = scriptedPromptIO((p) => {
    if (p.id === "name") return "app"
    if (p.id === "preset") return "saas"
    // the first confirmation: change parts; the second: no, so nothing is written
    if (p.id === "confirm")
      return s.shown.filter((x) => x.id === "confirm").length === 1 ? "change" : "no"
    if (p.id === "database") return "d1"
    return p.initial as string | string[]
  })
  await runWith(["--no-install", "--no-git"]).pipe(
    Effect.provide(
      Layer.mergeAll(NodeServices.layer, s.layer, Layer.succeed(TemplatesDir, templates)),
    ),
    Effect.runPromise,
  )
  expect(s.shown.map((x) => x.id)).toEqual([
    "name",
    "preset",
    "confirm",
    "database",
    "orm",
    "auth",
    "infra",
    "ai",
    "extras",
    "confirm",
  ])
  const confirm = s.shown[2]
  expect(confirm).toMatchObject({ kind: "select", options: ["yes", "change", "no"] })
  // each part starts on the preset's
  expect(s.shown.slice(3, 9).map((x) => x.initial)).toEqual([
    "postgres",
    "drizzle",
    "better-auth-orgs",
    "none",
    "none",
    ["storage", "email"],
  ])
  const notes = s.output.filter((o) => o.startsWith("note Your stack"))
  expect(notes[0]).toContain("note Your stack (the SaaS preset): ")
  expect(notes[0]).toContain("--preset=saas")
  expect(notes[1]).toContain("note Your stack (the SaaS preset, changed): ")
  expect(notes[1]).toMatch(/flags +--preset=saas --database=d1$/)
  expect(s.output.at(-1)).toBe("outro: Nothing written.")
  expect(process.exitCode ?? 0).toBe(0)
})

it("each preset's description fits the prompt at 80 columns", () => {
  for (const p of presets) expect(p.description.length, p.id).toBeLessThanOrEqual(47)
})
