// Just enough semver for comparing pins and reading `engines` ranges. Pins are exact versions;
// ranges are what package.json files use (`^24.11.0 || >=26.0.0`).

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

/** An exact version (`4.1.4`, `2.0.0-beta.87`), or undefined for a range, tag or protocol. */
export const exactVersion = (spec: string): string | undefined =>
  /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(spec.trim()) ? spec.trim() : undefined

const parts = (v: string) => (v.split("-")[0] ?? "").split(".").map((x) => Number(x) || 0)

/** One comparator (`^24.11.0`, `>=26`, `24.x`, `~1.2.3`, `1.2.3`) against `version`. */
const satisfiesOne = (version: string, comparator: string): boolean => {
  const c = comparator.trim()
  if (c === "" || c === "*" || c === "x") return true
  const m =
    /^(\^|~|>=|<=|>|<|=)?\s*v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(-[\w.-]+)?$/.exec(c)
  if (m === null) return false
  const [, op = "=", ma = "0", mi, pa, pre = ""] = m
  const wild = (s: string | undefined) => s === undefined || s === "x" || s === "*"
  const base = `${wild(ma) ? 0 : ma}.${wild(mi) ? 0 : mi}.${wild(pa) ? 0 : pa}${pre}`
  const cmp = compareVersions(version, base)
  const [vMa, vMi] = parts(version)
  switch (op) {
    case ">=":
      return cmp >= 0
    case ">":
      return cmp > 0
    case "<=":
      return cmp <= 0
    case "<":
      return cmp < 0
    case "^":
      return (
        cmp >= 0 && (Number(ma) === 0 ? vMa === 0 && vMi === Number(mi ?? 0) : vMa === Number(ma))
      )
    case "~":
      return cmp >= 0 && vMa === Number(ma) && (wild(mi) || vMi === Number(mi))
    default:
      if (wild(ma)) return true
      if (wild(mi)) return vMa === Number(ma)
      if (wild(pa)) return vMa === Number(ma) && vMi === Number(mi)
      return cmp === 0
  }
}

/** True when `version` is in `range` (`||` of space-separated comparators). */
export const satisfies = (version: string, range: string): boolean =>
  range.split("||").some((alt) =>
    alt
      .trim()
      .split(/\s+/)
      .every((c) => satisfiesOne(version.replace(/^v/, ""), c)),
  )
