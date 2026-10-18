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
  expect(toCommand(withDefaults({ name: "a" }))).toBe("npm create efforge a -- --yes")
})

it("toCommand includes non-defaults", () => {
  expect(
    toCommand(withDefaults({ name: "a", database: "none", extras: ["storage", "email"] })),
  ).toBe("npm create efforge a -- --yes --database=none --extras=storage,email")
})

it("ProjectName rejects unscoped slash and empty, accepts scoped", () => {
  const dec = Schema.decodeUnknownOption(ProjectName)
  expect(Option.isNone(dec("a/b"))).toBe(true)
  expect(Option.isNone(dec(""))).toBe(true)
  expect(Option.isSome(dec("@scope/name"))).toBe(true)
})

it("d1, workflows, realtime and browser require cloudflare", () => {
  const other = { runtime: "other" } as unknown as Parameters<typeof available>[1]
  expect(ids(available("database", other))).toEqual(["postgres", "none"])
  expect(ids(available("extras", other))).toEqual(["storage", "email"])
  const cf = { runtime: "cloudflare" } as const
  expect(ids(available("database", cf))).toContain("d1")
  expect(ids(available("extras", cf))).toEqual([
    "workflows",
    "realtime",
    "browser",
    "storage",
    "email",
  ])
})

it.effect("validate rejects cloudflare-only options on another runtime", () =>
  Effect.gen(function* () {
    const bad = {
      ...withDefaults({ name: "a" }),
      runtime: "other",
      extras: ["workflows"],
    } as unknown as Parameters<typeof validate>[0]
    const err = yield* Effect.flip(validate(bad))
    expect(err.slot).toBe("runtime")
  }),
)

it("toCommand output round-trips through withDefaults", () => {
  const cfgs = [
    withDefaults({ name: "a" }),
    withDefaults({ name: "a", database: "none", infra: "alchemy" }),
    withDefaults({
      name: "a",
      database: "d1",
      orm: "effect-sql",
      auth: "none",
      ai: "effect-ai-byok",
    }),
    withDefaults({ name: "a", orm: "none", extras: ["workflows", "email"] }),
  ]
  for (const c of cfgs) {
    const flags = Object.fromEntries(
      (toCommand(c).split(" -- ")[1] ?? "")
        .split(" ")
        .filter((f) => f.includes("="))
        .map((f) => f.slice(2).split("=") as [string, string]),
    )
    const { extras, ...rest } = flags
    const back = withDefaults({
      name: c.name,
      ...rest,
      ...(extras ? { extras: extras.split(",") } : {}),
    } as never)
    expect(back).toEqual(c)
  }
})
