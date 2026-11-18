import { expect, it } from "vitest"
import { compareVersions, exactVersion, satisfies } from "../src/semver.ts"

it("engines ranges as package.json files write them", () => {
  const range = "^24.11.0 || >=26.0.0"
  expect(satisfies("24.11.1", range)).toBe(true)
  expect(satisfies("24.10.0", range)).toBe(false)
  expect(satisfies("25.2.0", range)).toBe(false)
  expect(satisfies("26.13.1", range)).toBe(true)
  expect(satisfies("v22.3.0", ">=20")).toBe(true)
  expect(satisfies("1.2.9", "~1.2.3")).toBe(true)
  expect(satisfies("1.3.0", "~1.2.3")).toBe(false)
  expect(satisfies("0.2.5", "^0.2.1")).toBe(true)
  expect(satisfies("0.3.0", "^0.2.1")).toBe(false)
  expect(satisfies("18.0.0", "18.x")).toBe(true)
})

it("pins compare numerically, and a release outranks its pre-releases", () => {
  expect(compareVersions("4.0.5", "4.1.4")).toBe(-1)
  expect(compareVersions("1.170.46", "1.170.45")).toBe(1)
  expect(compareVersions("2.0.0-beta.87", "2.0.0-beta.9")).toBe(1)
  expect(compareVersions("1.0.0", "1.0.0-rc.5")).toBe(1)
  expect(exactVersion("4.1.4")).toBe("4.1.4")
  expect(exactVersion("^4.1.4")).toBeUndefined()
  expect(exactVersion("catalog:")).toBeUndefined()
})
