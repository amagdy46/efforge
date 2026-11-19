import { readFileSync } from "node:fs"

/**
 * Fails unless a vitest JSON report shows exactly `count` tests passed. A `-t` filter that
 * matches nothing skips every test and still exits 0, so the e2e jobs check what actually ran.
 *
 *   node scripts/expect-tests-ran.ts <report.json> <count>
 */
const [file, count] = process.argv.slice(2)
if (file === undefined || count === undefined)
  throw new Error("usage: node scripts/expect-tests-ran.ts <report.json> <count>")
const report = JSON.parse(readFileSync(file, "utf8")) as {
  numPassedTests: number
  numFailedTests: number
}
if (report.numPassedTests !== Number(count)) {
  console.error(
    `Expected ${count} test(s) to pass, but ${report.numPassedTests} passed and ${report.numFailedTests} failed.${report.numFailedTests === 0 ? " Check the -t filter: it may match nothing." : ""}`,
  )
  process.exitCode = 1
}
