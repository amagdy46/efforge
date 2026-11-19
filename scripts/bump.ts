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

/**
 * Pure: rewrites literal `"pkg": "old"` pins that are strictly behind a stable latest, except the
 * ones in `held` (pin -> why it stays), which it lists in `skipped` with the reason.
 */
export const applyBumps = (
  source: string,
  lines: ReadonlyArray<Line>,
  held: ReadonlyMap<string, string> = new Map(),
): { source: string; applied: string[]; skipped: string[] } => {
  let out = source
  const applied: string[] = []
  const skipped: string[] = []
  for (const l of lines) {
    if (l.status !== "behind" || l.latest === undefined || isPre(l.latest)) continue
    const reason = held.get(l.pkg)
    if (reason !== undefined) {
      skipped.push(`${l.pkg} ${l.pin} -> ${l.latest}: ${reason}`)
      continue
    }
    const key = l.pkg.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
    const re = new RegExp(`((?:"${key}"|\\b${key}):\\s*")${l.pin.replace(/[.+]/g, "\\$&")}(")`)
    if (!re.test(out)) continue // derived from a shared const (e.g. effect4): edit by hand
    out = out.replace(re, `$1${l.latest}$2`)
    applied.push(`${l.pkg} ${l.pin} -> ${l.latest}`)
  }
  return { source: out, applied, skipped }
}

/**
 * Pure: the supported-components table from @effect/tsgo's README (between the
 * `supported-components` markers), keyed by our package names.
 */
export const parseTsgoSupport = (readme: string): Record<string, ReadonlyArray<string>> => {
  const start = readme.indexOf("<!-- supported-components:start -->")
  const end = readme.indexOf("<!-- supported-components:end -->")
  if (start === -1 || end === -1) return {}
  const names: Record<string, string> = {
    TypeScript: "typescript",
    Oxlint: "oxlint",
    "oxlint-tsgolint": "oxlint-tsgolint",
  }
  const out: Record<string, ReadonlyArray<string>> = {}
  for (const line of readme.slice(start, end).split("\n")) {
    const [, component, versions] = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/.exec(line) ?? []
    const pkg = component === undefined ? undefined : names[component]
    if (pkg !== undefined && versions !== undefined)
      out[pkg] = [...versions.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string)
  }
  return out
}

/**
 * Pure: pins that break the lint toolchain. ADR 0001: @effect/tsgo only patches the TypeScript,
 * Oxlint and oxlint-tsgolint versions in its table, and Effect rules go quiet (or fail to load)
 * outside it. vite-plus bundles its own oxlint and vitest; a different vitest pin installs two
 * copies, and a different oxlint pin is not the one `vp lint` runs.
 */
export const checkToolchain = (
  pins: Readonly<Record<string, string>>,
  tsgoSupport: Readonly<Record<string, ReadonlyArray<string>>>,
  vitePlusDependencies: Readonly<Record<string, string>>,
): string[] => {
  const problems: string[] = []
  const tsgo = `@effect/tsgo ${pins["@effect/tsgo"] ?? "?"}`
  for (const pkg of ["typescript", "oxlint", "oxlint-tsgolint"]) {
    const supported = tsgoSupport[pkg]
    const pin = pins[pkg]
    if (supported === undefined) problems.push(`${tsgo}: no supported versions listed for ${pkg}`)
    else if (pin !== undefined && !supported.includes(pin))
      problems.push(`${pkg} ${pin} is not supported by ${tsgo} (${supported.join(", ")})`)
  }
  for (const pkg of ["oxlint", "vitest"]) {
    const bundled = vitePlusDependencies[pkg]?.replace(/^=/, "")
    const pin = pins[pkg]
    if (bundled !== undefined && pin !== undefined && bundled !== pin)
      problems.push(`${pkg} ${pin} differs from vite-plus ${pins["vite-plus"] ?? "?"}'s ${bundled}`)
  }
  return problems
}

/**
 * Pure: the behind pins that `--write` must leave alone, because moving them alone would break the
 * lint toolchain (vitest is held at the one vite-plus bundles). Maps each to the problem it causes.
 */
export const heldPins = (
  lines: ReadonlyArray<Line>,
  pins: Readonly<Record<string, string>>,
  tsgoSupport: Readonly<Record<string, ReadonlyArray<string>>>,
  vitePlusDependencies: Readonly<Record<string, string>>,
): Map<string, string> => {
  const before = new Set(checkToolchain(pins, tsgoSupport, vitePlusDependencies))
  const held = new Map<string, string>()
  for (const l of lines) {
    if (l.status !== "behind" || l.latest === undefined) continue
    const bumped = { ...pins, [l.pkg]: l.latest }
    const added = checkToolchain(bumped, tsgoSupport, vitePlusDependencies).filter(
      (p) => !before.has(p),
    )
    if (added.length > 0) held.set(l.pkg, added.join("; "))
  }
  return held
}

/** One field of one published version; `npm view --json` sometimes wraps it in an array. */
const npmView = async <A>(spec: string, field: string): Promise<A> => {
  const value = JSON.parse((await run("npm", ["view", spec, field, "--json"])).stdout) as A | A[]
  return (Array.isArray(value) ? value.at(-1) : value) as A
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
  const pins = (pin: string) => versions[pin] as string
  const tsgoSupport = parseTsgoSupport(
    await npmView<string>(`@effect/tsgo@${pins("@effect/tsgo")}`, "readme"),
  )
  const vitePlusDependencies = await npmView<Record<string, string>>(
    `vite-plus@${pins("vite-plus")}`,
    "dependencies",
  )
  const problems = checkToolchain(versions, tsgoSupport, vitePlusDependencies)
  console.log(
    problems.length === 0
      ? "\nlint toolchain: pins fit @effect/tsgo's supported table and vite-plus's bundle"
      : `\nlint toolchain problems:\n${problems.map((p) => `  ${p}`).join("\n")}`,
  )
  if (problems.length > 0) process.exitCode = 1
  if (write) {
    const file = new URL("../src/versions.ts", import.meta.url)
    const held = heldPins(lines, versions, tsgoSupport, vitePlusDependencies)
    const { source, applied, skipped } = applyBumps(readFileSync(file, "utf8"), lines, held)
    writeFileSync(file, source)
    if (skipped.length > 0) console.log(`\nheld (not written):\n${skipped.join("\n")}`)
    console.log(applied.length > 0 ? `\nwrote:\n${applied.join("\n")}` : "\nnothing to write")
  } else {
    console.log(
      "\n(dry run: pass --write to bump behind pins to a stable latest in src/versions.ts)",
    )
  }
}
