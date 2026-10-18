import { readFileSync } from "node:fs"

/** Case names declared in the `stacks` table of test/e2e/stacks.test.ts (`["name", { ... }]` rows). */
export const e2eCases = (source: string): string[] => {
  const table = source.slice(
    source.indexOf("const stacks"),
    source.indexOf('describe("stacks build"'),
  )
  return [...table.matchAll(/^ {2}\[\s*"([a-z0-9-]+)",/gm)].map((m) => m[1] as string)
}

if (import.meta.main) {
  const file = new URL("../test/e2e/stacks.test.ts", import.meta.url)
  const cases = e2eCases(readFileSync(file, "utf8"))
  if (cases.length === 0) throw new Error("no e2e cases found in test/e2e/stacks.test.ts")
  // GitHub Actions `fromJSON` input: {"case":[...]} fits `matrix: ${{ fromJSON(...) }}`
  console.log(JSON.stringify({ case: cases }))
}
