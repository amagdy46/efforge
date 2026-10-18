import { execFile } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { promisify } from "node:util"

const run = promisify(execFile)

export interface Row {
  readonly pkg: string
  readonly pin: string
  readonly latest: string | undefined
}

export type Status = "current" | "behind" | "ahead" | "unknown"

export interface Line extends Row {
  readonly status: Status
  readonly flags: ReadonlyArray<string>
}

const isPre = (v: string) => v.includes("-")

/** Numeric dotted core, then a release outranks any pre-release; pre-releases compare by identifier. */
export const compareVersions = (a: string, b: string): number => {
  const [coreA = "", preA] = a.split(/-(.*)/s)
  const [coreB = "", preB] = b.split(/-(.*)/s)
  const pa = coreA.split(".").map(Number)
  const pb = coreB.split(".").map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return Math.sign(d)
  }
  if (preA === undefined && preB === undefined) return 0
  if (preA === undefined) return 1
  if (preB === undefined) return -1
  const ia = preA.split(/[.-]/)
  const ib = preB.split(/[.-]/)
  for (let i = 0; i < Math.max(ia.length, ib.length); i++) {
    const x = ia[i]
    const y = ib[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = Number(x)
    const ny = Number(y)
    const d =
      Number.isNaN(nx) || Number.isNaN(ny) ? (x < y ? -1 : x > y ? 1 : 0) : Math.sign(nx - ny)
    if (d !== 0) return d
  }
  return 0
}

/** Pure: classifies each pin against the registry's `latest` tag and flags pre-releases. */
export const diffPins = (rows: ReadonlyArray<Row>): Line[] =>
  rows.map((row) => {
    const flags: string[] = []
    if (isPre(row.pin)) flags.push("pinned pre-release")
    if (row.latest !== undefined && isPre(row.latest)) flags.push("latest is pre-release")
    if (row.latest === undefined) return { ...row, status: "unknown", flags }
    const c = compareVersions(row.pin, row.latest)
    return { ...row, status: c === 0 ? "current" : c < 0 ? "behind" : "ahead", flags }
  })

/** Pure: an aligned table, one row per pin. */
export const formatReport = (lines: ReadonlyArray<Line>): string => {
  const w = (f: (l: Line) => string) => Math.max(...lines.map((l) => f(l).length), 1)
  const wPkg = w((l) => l.pkg)
  const wPin = w((l) => l.pin)
  const mark: Record<Status, string> = { current: "=", behind: "^", ahead: "v", unknown: "?" }
  const body = lines.map((l) => {
    const flags = l.flags.length > 0 ? `  [${l.flags.join(", ")}]` : ""
    const row = `${mark[l.status]} ${l.pkg.padEnd(wPkg)}  ${l.pin.padEnd(wPin)}  ${l.latest ?? "?"}`
    return row + flags
  })
  const behind = lines.filter((l) => l.status === "behind").length
  return [
    `  ${"package".padEnd(wPkg)}  ${"pin".padEnd(wPin)}  latest`,
    ...body,
    "",
    `${lines.length} pins, ${behind} behind latest (= current, ^ behind, v ahead, ? lookup failed)`,
  ].join("\n")
}

/** Pure: rewrites literal `"pkg": "old"` pins that are strictly behind a stable latest. */
export const applyBumps = (
  source: string,
  lines: ReadonlyArray<Line>,
): { source: string; applied: string[] } => {
  let out = source
  const applied: string[] = []
  for (const l of lines) {
    if (l.status !== "behind" || l.latest === undefined || isPre(l.latest)) continue
    const key = l.pkg.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
    const re = new RegExp(`((?:"${key}"|\\b${key}):\\s*")${l.pin.replace(/[.+]/g, "\\$&")}(")`)
    if (!re.test(out)) continue // derived from a shared const (e.g. effect4): edit by hand
    out = out.replace(re, `$1${l.latest}$2`)
    applied.push(`${l.pkg} ${l.pin} -> ${l.latest}`)
  }
  return { source: out, applied }
}

const latestOf = async (pkg: string): Promise<string | undefined> => {
  try {
    const { stdout } = await run("npm", ["view", pkg, "dist-tags.latest"])
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

const mapLimit = async <A, B>(xs: ReadonlyArray<A>, n: number, f: (a: A) => Promise<B>) => {
  const out: B[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < xs.length) {
        const i = next++
        out[i] = await f(xs[i] as A)
      }
    }),
  )
  return out
}

if (import.meta.main) {
  const write = process.argv.includes("--write")
  const { versions } = await import("../src/versions.ts")
  const entries = Object.entries(versions)
  const latest = await mapLimit(entries, 8, ([pkg]) => latestOf(pkg))
  const lines = diffPins(entries.map(([pkg, pin], i) => ({ pkg, pin, latest: latest[i] })))
  console.log(formatReport(lines))
  if (write) {
    const file = new URL("../src/versions.ts", import.meta.url)
    const { source, applied } = applyBumps(readFileSync(file, "utf8"), lines)
    writeFileSync(file, source)
    console.log(applied.length > 0 ? `\nwrote:\n${applied.join("\n")}` : "\nnothing to write")
  } else {
    console.log(
      "\n(dry run: pass --write to bump behind pins to a stable latest in src/versions.ts)",
    )
  }
}
