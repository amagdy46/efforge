import { expect, it } from "vitest"
import {
  efforgeDeclared,
  efforgeGenerated,
  efforgeWroteScript,
  ownRelease,
  releases,
  releasesSince,
} from "../src/history.ts"
import { compareWithRecord, shingles } from "../src/record.ts"
import { efforgeVersion } from "../src/versions.ts"

const older = [
  "export const AppLayer = Layer.mergeAll(",
  "  NotesLive,",
  "  AuthLive,",
  ")",
  "// the layers every request gets",
].join("\n")
// today's file adds a block; this release's record holds it once scripts/history.ts ran
const today = `${older}\n// #region card\nexport const shown = AppLayer.pipe(Layer.provide(TelemetryLive))\n// #endregion card\n`

it("an older release's file, unedited, is refreshed once this release's own record holds today's lines", () => {
  const own = shingles(older)
  const record = new Set([...own, ...shingles(today)]) // the releases since the project's, this one included
  expect(compareWithRecord(older, today, record, undefined, own)).toBe("refresh")
})

it("a line the project's own release wrote and the owner took out is still theirs to keep out", () => {
  const own = shingles(older)
  const record = new Set([...own, ...shingles(today)])
  const edited = older.replace("  AuthLive,\n", "")
  expect(compareWithRecord(edited, today, record, undefined, own)).toBe("review")
})

it("missing-means-removed asks only the project's own release, never a later one or this one", () => {
  const all = Object.keys(releases)
  expect(all).toContain(efforgeVersion)
  const first = all[0] as string
  expect(ownRelease(first).map(([v]) => v)).toEqual([first])
  expect(releasesSince(first).map(([v]) => v)).toContain(efforgeVersion)
  // what this release generates for the first time is new to a project from an older one
  const newHere = Object.keys(releases[efforgeVersion]?.records ?? {}).filter(
    (f) => releases[first]?.records[f] === undefined,
  )
  expect(newHere.length).toBeGreaterThan(0)
  for (const f of newHere) expect(efforgeGenerated(first, f)).toBe(false)
  const deps = releases[efforgeVersion]?.dependencies["package.json"] ?? []
  for (const d of deps.filter(
    (x) => !(releases[first]?.dependencies["package.json"] ?? []).includes(x),
  ))
    expect(efforgeDeclared(first, "package.json", d)).toBe(false)
  const scripts = Object.keys(releases[efforgeVersion]?.scripts["package.json"] ?? {}).filter(
    (n) => releases[first]?.scripts["package.json"]?.[n] === undefined,
  )
  for (const n of scripts) expect(efforgeWroteScript(first, "package.json", n, {})).toBe(false)
})
