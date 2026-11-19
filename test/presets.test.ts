import { expect, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { askStack } from "../src/prompts/flow.ts"
import { GoBack, PromptIO, scriptedPromptIO } from "../src/prompts/navigable.ts"
import { presets } from "../src/presets.ts"
import { validate } from "../src/rules.ts"
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
