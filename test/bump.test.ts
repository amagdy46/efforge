import { expect, it } from "@effect/vitest"
import {
  applyBumps,
  checkToolchain,
  heldPins,
  compareVersions,
  diffPins,
  formatReport,
  parseTsgoSupport,
} from "../scripts/bump.ts"
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

it("reads @effect/tsgo's supported-components table", () => {
  const readme = [
    "intro | not | a table |",
    "<!-- supported-components:start -->",
    "| Component | Supported versions |",
    "|---|---|",
    "| TypeScript | `7.0.2`, `7.1.0-beta` |",
    "| tsrs | `0.25.0` |",
    "| Oxlint | `1.93.0`, `1.94.0` |",
    "| oxlint-tsgolint | `7.0.2007` |",
    "<!-- supported-components:end -->",
  ].join("\n")
  expect(parseTsgoSupport(readme)).toEqual({
    typescript: ["7.0.2", "7.1.0-beta"],
    oxlint: ["1.93.0", "1.94.0"],
    "oxlint-tsgolint": ["7.0.2007"],
  })
  expect(parseTsgoSupport("no table")).toEqual({})
})

it("flags lint-toolchain pins outside tsgo's table or vite-plus's bundle", () => {
  const support = { typescript: ["7.0.2"], oxlint: ["1.94.0"], "oxlint-tsgolint": ["7.0.2007"] }
  const bundle = { oxlint: "=1.94.0", vitest: "5.1.0" }
  const pins = {
    "@effect/tsgo": "0.70.0",
    "vite-plus": "1.7.0",
    typescript: "7.0.2",
    oxlint: "1.94.0",
    "oxlint-tsgolint": "7.0.2007",
    vitest: "5.1.0",
  }
  expect(checkToolchain(pins, support, bundle)).toEqual([])
  expect(checkToolchain({ ...pins, oxlint: "1.88.0", vitest: "5.1.1" }, support, bundle)).toEqual([
    "oxlint 1.88.0 is not supported by @effect/tsgo 0.70.0 (1.94.0)",
    "oxlint 1.88.0 differs from vite-plus 1.7.0's 1.94.0",
    "vitest 5.1.1 differs from vite-plus 1.7.0's 5.1.0",
  ])
  expect(checkToolchain(pins, {}, bundle)).toHaveLength(3)
})

it("--write holds a pin the lint toolchain fixes, and says why", () => {
  const support = { typescript: ["7.0.2"], oxlint: ["1.94.0"], "oxlint-tsgolint": ["7.0.2007"] }
  const bundle = { oxlint: "=1.94.0", vitest: "5.1.0" }
  const pins = {
    "@effect/tsgo": "0.70.0",
    "vite-plus": "1.7.0",
    typescript: "7.0.2",
    oxlint: "1.94.0",
    "oxlint-tsgolint": "7.0.2007",
    vitest: "5.1.0",
    react: "19.3.1",
  }
  const lines = diffPins([
    { pkg: "vitest", pin: "5.1.0", latest: "5.1.1" },
    { pkg: "react", pin: "19.3.1", latest: "19.3.2" },
  ])
  const held = heldPins(lines, pins, support, bundle)
  expect([...held.keys()]).toEqual(["vitest"])
  const src = `{\n  react: "19.3.1",\n  vitest: "5.1.0",\n}`
  const { source, applied, skipped } = applyBumps(src, lines, held)
  expect(applied).toEqual(["react 19.3.1 -> 19.3.2"])
  expect(skipped).toEqual([
    "vitest 5.1.0 -> 5.1.1: vitest 5.1.1 differs from vite-plus 1.7.0's 5.1.0",
  ])
  expect(source).toContain('vitest: "5.1.0"')
  expect(checkToolchain({ ...pins, vitest: "5.1.0" }, support, bundle)).toEqual([])
})
