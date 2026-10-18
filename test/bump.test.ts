import { expect, it } from "@effect/vitest"
import { applyBumps, compareVersions, diffPins, formatReport } from "../scripts/bump.ts"
import { e2eCases } from "../scripts/e2e-cases.ts"

it("orders versions, releases above pre-releases", () => {
  expect(compareVersions("1.2.3", "1.2.4")).toBe(-1)
  expect(compareVersions("1.10.0", "1.9.0")).toBe(1)
  expect(compareVersions("2.0.0-beta.83", "2.0.0-beta.9")).toBe(1)
  expect(compareVersions("2.0.0-beta.83", "2.0.0")).toBe(-1)
  expect(compareVersions("1.0.0", "1.0.0")).toBe(0)
})

it("classifies pins and flags pre-releases", () => {
  const lines = diffPins([
    { pkg: "a", pin: "1.0.0", latest: "1.0.0" },
    { pkg: "b", pin: "1.0.0", latest: "1.1.0" },
    { pkg: "alchemy", pin: "2.0.0-beta.83", latest: "2.0.0-beta.90" },
    { pkg: "drizzle-orm", pin: "1.0.0-rc.5", latest: "0.45.2" },
    { pkg: "c", pin: "1.0.0", latest: undefined },
  ])
  expect(lines.map((l) => l.status)).toEqual(["current", "behind", "behind", "ahead", "unknown"])
  expect(lines[2]?.flags).toEqual(["pinned pre-release", "latest is pre-release"])
  expect(lines[3]?.flags).toEqual(["pinned pre-release"])
})

it("formats an aligned report with a summary", () => {
  const out = formatReport(
    diffPins([
      { pkg: "a", pin: "1.0.0", latest: "1.0.0" },
      { pkg: "long-name", pin: "1.0.0", latest: "1.1.0-rc.1" },
    ]),
  )
  expect(out).toContain("= a          1.0.0  1.0.0")
  expect(out).toContain("^ long-name  1.0.0  1.1.0-rc.1  [latest is pre-release]")
  expect(out).toContain("2 pins, 1 behind latest")
})

it("--write only moves literal pins to a stable newer latest", () => {
  const src = `const e = "4.0.5"\n{\n  effect: e,\n  "better-auth": "1.7.10",\n  react: "19.3.1",\n  alchemy: "2.0.0-beta.83",\n}`
  const lines = diffPins([
    { pkg: "better-auth", pin: "1.7.10", latest: "1.8.0" },
    { pkg: "react", pin: "19.3.1", latest: "20.0.0-rc.1" },
    { pkg: "alchemy", pin: "2.0.0-beta.83", latest: "2.0.0" },
  ])
  const { source, applied } = applyBumps(src, lines)
  expect(applied).toEqual(["better-auth 1.7.10 -> 1.8.0", "alchemy 2.0.0-beta.83 -> 2.0.0"])
  expect(source).toContain('"better-auth": "1.8.0"')
  expect(source).toContain('react: "19.3.1"')
  expect(source).toContain('alchemy: "2.0.0"')
})

it("derives e2e case names from the stacks table", () => {
  const src = `const stacks = [\n  [\n    "minimal",\n    {},\n  ],\n  ["pg-drizzle", { a: 1 }],\n]\ndescribe("stacks build", () => {})`
  expect(e2eCases(src)).toEqual(["minimal", "pg-drizzle"])
})
