import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { askStack, InvalidProjectName } from "../src/prompts/flow.ts"
import { CANCEL, GoBack, PromptIO, scriptedPromptIO } from "../src/prompts/navigable.ts"
import { IncompatibleStack } from "../src/rules.ts"

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

it.effect("full interactive run", () =>
  Effect.gen(function* () {
    const { s, result } = run({}, [
      "app",
      "d1",
      "drizzle",
      "better-auth",
      "alchemy",
      "effect-ai-byok",
      ["email", "storage"],
    ])
    const cfg = yield* result
    expect(cfg).toEqual({
      name: "app",
      runtime: "cloudflare",
      database: "d1",
      orm: "drizzle",
      auth: "better-auth",
      infra: "alchemy",
      ai: "effect-ai-byok",
      extras: ["email", "storage"],
    })
    // runtime has a single option so it is never asked; first select cannot go back
    expect(s.shown.map((x) => x.id)).toEqual([
      "name",
      "database",
      "orm",
      "auth",
      "infra",
      "ai",
      "extras",
    ])
    expect(s.shown.find((x) => x.id === "database")?.canGoBack).toBe(false)
    expect(s.shown.find((x) => x.id === "orm")?.canGoBack).toBe(true)
    expect(s.output.filter((o) => o.startsWith("section:"))).toEqual([
      "section: Data",
      "section: Platform",
      "section: Features",
    ])
  }),
)

it.effect("a back step re-asks the previous slot and clears later answers", () =>
  Effect.gen(function* () {
    // database=postgres, orm=drizzle, auth=back -> orm again (=none? not allowed with postgres) ...
    const { s, result } = run({}, [
      "app",
      "postgres",
      "drizzle",
      GoBack, // at auth: back to orm
      GoBack, // at orm: back to database
      "none", // database=none -> orm, auth auto-skipped
      "none", // infra
      "none", // ai
      [],
    ])
    const cfg = yield* result
    expect(cfg.database).toBe("none")
    expect(cfg.orm).toBe("none")
    expect(cfg.auth).toBe("none")
    expect(s.shown.map((x) => x.id)).toEqual([
      "name",
      "database",
      "orm",
      "auth",
      "orm",
      "database",
      "infra",
      "ai",
      "extras",
    ])
  }),
)

it.effect("--database=none never shows orm or auth prompts", () =>
  Effect.gen(function* () {
    const { s, result } = run({ name: "app", database: "none" }, ["none", "none", []])
    const cfg = yield* result
    expect(cfg).toMatchObject({ database: "none", orm: "none", auth: "none" })
    expect(s.shown.map((x) => x.id)).toEqual(["infra", "ai", "extras"])
  }),
)

it.effect("flags skip their prompt and back skips them too", () =>
  Effect.gen(function* () {
    const { s, result } = run({ name: "app", orm: "drizzle" }, [
      "postgres",
      "better-auth",
      GoBack,
      GoBack,
      "d1",
      "better-auth",
      "none",
      "none",
      [],
    ])
    const cfg = yield* result
    // orm is flag-skipped, so back from auth lands on database
    expect(cfg.database).toBe("d1")
    expect(s.shown.map((x) => x.id)).toEqual([
      "database",
      "auth",
      "infra",
      "auth",
      "database",
      "auth",
      "infra",
      "ai",
      "extras",
    ])
  }),
)

it.effect("--auth=better-auth --database=none fails with IncompatibleStack listing options", () =>
  Effect.gen(function* () {
    const { result } = run({ name: "app", database: "none", auth: "better-auth" }, [])
    const err = yield* result.pipe(Effect.flip)
    expect(err).toBeInstanceOf(IncompatibleStack)
    expect(err).toMatchObject({ slot: "auth", value: "better-auth", allowed: ["none"] })
  }),
)

it.effect("same failure with --yes", () =>
  Effect.gen(function* () {
    const { result } = run({ name: "app", database: "none", auth: "better-auth" }, [], true)
    const err = yield* result.pipe(Effect.flip)
    expect(err).toMatchObject({ _tag: "IncompatibleStack", slot: "auth" })
  }),
)

it.effect("unknown flag value is IncompatibleStack, not a crash", () =>
  Effect.gen(function* () {
    const { result } = run({ name: "app", database: "mysql" }, [])
    const err = yield* result.pipe(Effect.flip)
    expect(err).toMatchObject({ _tag: "IncompatibleStack", slot: "database", value: "mysql" })
  }),
)

it.effect("--yes asks nothing and uses defaults, honouring flags", () =>
  Effect.gen(function* () {
    const { s, result } = run({ name: "app", database: "d1" }, [], true)
    const cfg = yield* result
    expect(s.shown).toEqual([])
    expect(cfg).toMatchObject({
      name: "app",
      database: "d1",
      orm: "drizzle",
      auth: "better-auth-orgs",
      infra: "none",
      ai: "none",
      extras: [],
    })
  }),
)

it.effect("--yes without a name uses my-app", () =>
  Effect.gen(function* () {
    const { s, result } = run({}, [], true)
    expect((yield* result).name).toBe("my-app")
    expect(s.shown).toEqual([])
  }),
)

it.effect("invalid project names are rejected", () =>
  Effect.gen(function* () {
    for (const name of ["My App", "../x"]) {
      const { result } = run({ name }, [], true)
      expect(yield* result.pipe(Effect.flip)).toBeInstanceOf(InvalidProjectName)
    }
  }),
)

it.effect("cancel anywhere fails with Cancelled", () =>
  Effect.gen(function* () {
    const { result } = run({ name: "app" }, ["postgres", CANCEL])
    expect(yield* result.pipe(Effect.flip)).toMatchObject({ _tag: "Cancelled" })
  }),
)
