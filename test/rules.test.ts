import { expect, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { IncompatibleStack, validate } from "../src/rules.ts"
import { available, slots } from "../src/slots.ts"
import { ProjectName, toCommand, withDefaults } from "../src/stack.ts"

const ids = (xs: ReadonlyArray<{ id: string }>) => xs.map((x) => x.id)

it("orm is only none when database is none", () => {
  expect(ids(available("orm", { database: "none" }))).toEqual(["none"])
})

it("orm excludes none when a database is chosen", () => {
  expect(ids(available("orm", { database: "postgres" }))).toEqual(["drizzle", "effect-sql"])
})

it("auth is only none when database is none", () => {
  expect(ids(available("auth", { database: "none" }))).toEqual(["none"])
})

it("slots are ordered", () => {
  expect(slots.map((s) => s.id)).toEqual([
    "runtime",
    "database",
    "orm",
    "auth",
    "infra",
    "ai",
    "extras",
  ])
})

it("withDefaults equals the default row", () => {
  expect(withDefaults({ name: "a" })).toEqual({
    name: "a",
    runtime: "cloudflare",
    database: "postgres",
    orm: "drizzle",
    auth: "better-auth-orgs",
    infra: "none",
    ai: "none",
    extras: [],
  })
})

it("withDefaults with database none disables orm and auth", () => {
  const c = withDefaults({ name: "a", database: "none" })
  expect(c.orm).toBe("none")
  expect(c.auth).toBe("none")
})

it.effect("validate fails on auth without database", () =>
  Effect.gen(function* () {
    const bad = {
      ...withDefaults({ name: "a" }),
      database: "none",
      orm: "none",
      auth: "better-auth",
    } as const
    const err = yield* Effect.flip(validate(bad))
    expect(err).toBeInstanceOf(IncompatibleStack)
    expect(err.slot).toBe("auth")
    expect(err.allowed).toEqual(["none"])
  }),
)

it.effect("validate fails on orm without database", () =>
  Effect.gen(function* () {
    const bad = { ...withDefaults({ name: "a" }), database: "none", auth: "none" } as const
    const err = yield* Effect.flip(validate(bad))
    expect(err.slot).toBe("orm")
  }),
)

it.effect("validate accepts defaults", () =>
  validate(withDefaults({ name: "a" })).pipe(Effect.map((c) => expect(c.name).toBe("a"))),
)

it("ProjectName rejects bad names", () => {
  const dec = Schema.decodeUnknownOption(ProjectName)
  expect(Option.isNone(dec("My App"))).toBe(true)
  expect(Option.isNone(dec("../x"))).toBe(true)
  expect(Option.isNone(dec("a..b"))).toBe(true)
  expect(Option.isSome(dec("my-app"))).toBe(true)
  expect(Option.isSome(dec("@scope/my-app"))).toBe(true)
})

it("toCommand omits defaults", () => {
  expect(toCommand(withDefaults({ name: "a" }))).toBe("npm create efforge a")
})

it("toCommand includes non-defaults", () => {
  expect(
    toCommand(withDefaults({ name: "a", database: "none", extras: ["storage", "email"] })),
  ).toBe("npm create efforge a -- --database=none --extras=storage,email")
})
