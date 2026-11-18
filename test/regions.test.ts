import { describe, expect, it } from "vitest"
import { fillRegions, parseRegions, syncSections } from "../src/regions.ts"

// A seeded property test of the marked regions `add` rewrites in README.md and AGENTS.md: files
// with random user text and random marker damage, and the promise that no byte outside a
// well-formed region is lost, duplicated or reordered; a malformed file is not touched at all.
// EFFORGE_SEED=<n> reruns one seed; EFFORGE_CASES=<n> runs more cases.

const SEED = Number(process.env.EFFORGE_SEED ?? 0x2d2)
const CASES = Number(process.env.EFFORGE_CASES ?? 3000)

/** mulberry32: small, seeded, good enough to pick cases. */
const rng = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rand = () => number
const int = (r: Rand, n: number) => Math.floor(r() * n)
const pick = <T>(r: Rand, xs: ReadonlyArray<T>): T => xs[int(r, xs.length)] as T

interface Line {
  text: string
  /** The user's: outside every well-formed region. */
  user: boolean
}

type Damage =
  | "dupOpen"
  | "dupClose"
  | "dropOpen"
  | "dropClose"
  | "reorder"
  | "nest"
  | "dropPair"
  | "strayOpen"
  | "strayClose"

const userLine = (r: Rand, prefix: string, ids: ReadonlyArray<string>): string =>
  pick(r, [
    () => "",
    () => `## Heading ${int(r, 99)}`,
    () => `Some text ${int(r, 1e6)} the user wrote.`,
    // a marker quoted in prose is prose
    () => `Do not remove \`<!-- ${prefix}:${pick(r, ids)} -->\` below.`,
    () => `<!-- ${prefix}:${pick(r, ids)} --> and more on the same line`,
    () => `<!-- /${prefix}:${pick(r, ids)} -->.`,
    () => "<!-- a comment of the user's -->",
    () => "```sh",
    () => "| a | b |",
    () => "   indented text",
    () => "trailing spaces   ",
  ])()

interface Case {
  readonly text: string
  readonly lines: ReadonlyArray<Line>
  readonly damage: ReadonlyArray<Damage>
  /** Ids of the regions left well-formed. */
  readonly intact: ReadonlyArray<string>
  readonly crlf: boolean
}

/**
 * User text with well-formed regions of `ids` (a random subset, in random order), then up to two
 * kinds of damage on distinct regions, written with LF or CRLF, with or without a final newline.
 */
const makeCase = (
  r: Rand,
  prefix: string,
  ids: ReadonlyArray<string>,
  extra: (lines: Line[]) => void = () => {},
): Case => {
  const chosen = ids.filter(() => r() < 0.6).toSorted(() => r() - 0.5)
  const open = (id: string) => `<!-- ${prefix}:${id} -->`
  const close = (id: string) => `<!-- /${prefix}:${id} -->`
  const users = () =>
    Array.from({ length: int(r, 5) }, () => ({ text: userLine(r, prefix, ids), user: true }))
  type Block = { id: string; lines: Line[]; damaged?: true }
  const blocks: Block[] = chosen.map((id) => ({
    id,
    lines: [
      { text: open(id), user: false },
      ...Array.from({ length: int(r, 4) }, () => ({
        text: `efforge's ${id} ${int(r, 1e6)}`,
        user: false,
      })),
      { text: close(id), user: false },
    ],
  }))
  const damage: Damage[] = []
  const free = [...blocks]
  const take = () => free.splice(int(r, free.length), 1)[0]
  const kinds: Damage[] = [
    "dupOpen",
    "dupClose",
    "dropOpen",
    "dropClose",
    "reorder",
    "nest",
    "dropPair",
    "strayOpen",
    "strayClose",
  ]
  const strays: Line[] = []
  const strayIds = new Set<string>()
  for (let k = int(r, 3); k > 0; k--) {
    const kind = pick(r, kinds)
    if (kind === "strayOpen" || kind === "strayClose") {
      // a stray open and a stray close of one id would make a region, so each stray has its own id
      const unused = ids.filter((id) => !chosen.includes(id) && !strayIds.has(id))
      if (unused.length === 0) continue
      const id = pick(r, unused)
      strayIds.add(id)
      strays.push({ text: kind === "strayOpen" ? open(id) : close(id), user: true })
      damage.push(kind)
      continue
    }
    const b = take()
    if (b === undefined) continue
    const first = b.lines[0] as Line
    const last = b.lines[b.lines.length - 1] as Line
    if (kind === "dupOpen") strays.push({ text: first.text, user: true })
    else if (kind === "dupClose") strays.push({ text: last.text, user: true })
    else if (kind === "dropOpen") b.lines.shift()
    else if (kind === "dropClose") b.lines.pop()
    else if (kind === "reorder") {
      b.lines[0] = last
      b.lines[b.lines.length - 1] = first
    } else if (kind === "dropPair") {
      b.lines = b.lines.slice(1, -1).map((l) => ({ ...l, user: true }))
    } else if (kind === "nest") {
      const inner = take()
      if (inner === undefined) {
        free.push(b)
        continue
      }
      b.lines.splice(1 + int(r, b.lines.length - 1), 0, ...inner.lines)
      blocks.splice(blocks.indexOf(inner), 1)
    }
    b.damaged = true
    damage.push(kind)
  }
  const lines: Line[] = [...users()]
  for (const b of blocks) lines.push(...b.lines, ...users())
  // stray markers anywhere outside the blocks
  for (const s of strays) {
    const outside = lines.flatMap((l, i) => (l.user ? [i] : [])).concat([lines.length])
    lines.splice(pick(r, outside), 0, s)
  }
  extra(lines)
  const crlf = r() < 0.25
  const finalNewline = r() < 0.8
  // the user's lines get CR when the file is CRLF, as an editor would write them
  const eol = crlf ? "\r\n" : "\n"
  const text = lines.map((l) => l.text).join(eol) + (finalNewline ? eol : "")
  const split = text.split("\n")
  const tagged = split.map((t, i) => ({ text: t, user: lines[i]?.user ?? true }))
  return {
    text,
    lines: tagged,
    damage,
    intact: blocks.filter((b) => b.damaged !== true).map((b) => b.id),
    crlf,
  }
}

/** Lines outside the well-formed regions of `text`, in order. */
const outside = (text: string, prefix: string): string[] => {
  const p = parseRegions(text, prefix)
  if (!p.ok) throw new Error(`output is malformed: ${p.problems.join("; ")}`)
  const inside = new Set(
    p.regions.flatMap((reg) =>
      Array.from({ length: reg.close - reg.open + 1 }, (_, i) => reg.open + i),
    ),
  )
  return p.lines.filter((_, i) => !inside.has(i))
}

/** True when `small` is `big` with only blank lines added. */
const blankLinesAdded = (small: ReadonlyArray<string>, big: ReadonlyArray<string>): boolean => {
  let i = 0
  for (const line of big) {
    if (i < small.length && line === small[i]) i++
    else if (line.trim() !== "") return false
  }
  return i === small.length
}

const README_PREFIX = "efforge:readme"
const README_IDS = ["about", "run", "scripts", "layout", "capabilities", "deploy", "custom"]
const MALFORMING = new Set<Damage>([
  "dupOpen",
  "dupClose",
  "dropOpen",
  "dropClose",
  "reorder",
  "nest",
  "strayOpen",
  "strayClose",
])

describe(`marked regions (seed ${SEED}, ${CASES} cases per file)`, () => {
  it("README: a well-formed file keeps every user line in order; a malformed one is not touched", () => {
    const r = rng(SEED)
    const seen = { filled: 0, malformed: 0, none: 0 }
    for (let n = 0; n < CASES; n++) {
      const c = makeCase(r, README_PREFIX, README_IDS)
      const contents = Object.fromEntries(
        README_IDS.filter((id) => id !== "custom").map((id) => [
          id,
          `new ${id}\n\nline ${int(r, 99)}`,
        ]),
      )
      const result = fillRegions(c.text, README_PREFIX, contents)
      const why = `seed ${SEED} case ${n}: ${JSON.stringify(c.text)}`
      if (c.damage.some((d) => MALFORMING.has(d))) {
        expect(result.kind, why).toBe("malformed")
        seen.malformed++
        continue
      }
      if (c.intact.length === 0) {
        expect(result.kind, why).toBe("no-markers")
        seen.none++
        continue
      }
      expect(result.kind, why).toBe("filled")
      if (result.kind !== "filled") continue
      seen.filled++
      expect(outside(result.text, README_PREFIX), why).toEqual(
        c.lines.filter((l) => l.user).map((l) => l.text),
      )
      // each region holds its new content, written with the file's line endings
      const p = parseRegions(result.text, README_PREFIX)
      if (!p.ok) throw new Error(why)
      for (const reg of p.regions) {
        const body = p.lines.slice(reg.open + 1, reg.close)
        if (reg.id === "custom") continue
        expect(
          body.map((l) => l.replace(/\r$/, "")),
          why,
        ).toEqual(["", ...(contents[reg.id] as string).split("\n"), ""])
        if (c.crlf)
          expect(
            body.every((l) => l.endsWith("\r")),
            why,
          ).toBe(true)
      }
      // a second fill changes nothing
      const again = fillRegions(result.text, README_PREFIX, contents)
      expect(again.kind === "filled" && again.text, why).toBe(result.text)
    }
    // every outcome was exercised
    expect(seen.filled).toBeGreaterThan(CASES / 10)
    expect(seen.malformed).toBeGreaterThan(CASES / 10)
    expect(seen.none).toBeGreaterThan(0)
  })

  it("AGENTS.md: sections are rewritten and inserted in order, every user line kept", () => {
    const r = rng(SEED + 1)
    const prefix = "efforge:section"
    const footer = "<!-- efforge:agents -->"
    const ids = ["database", "database-wrangler", "orm", "auth", "auth-secret", "email", "alchemy"]
    const seen = { synced: 0, malformed: 0, legacy: 0 }
    for (let n = 0; n < CASES; n++) {
      let footers = 0
      const c = makeCase(r, prefix, ids, (lines) => {
        // the footer: usually last, sometimes missing, sometimes twice
        const k = r() < 0.8 ? 1 : r() < 0.5 ? 0 : 2
        footers = k
        for (let i = 0; i < k; i++)
          lines.push({ text: footer, user: true }, { text: "", user: true })
      })
      // wanted: every section the file has (so none is removed) and some new ones, in a random order
      const wanted = ids
        .filter((id) => c.intact.includes(id) || r() < 0.4)
        .toSorted(() => r() - 0.5)
        .map((id) => ({ id, content: `## ${id}\n\nnew ${int(r, 99)}` }))
      const result = syncSections(c.text, prefix, wanted, { footer, owned: () => true })
      const why = `seed ${SEED + 1} case ${n}: ${JSON.stringify(c.text)} wanted ${wanted.map((w) => w.id).join(",")}`
      const lone = c.damage.filter((d) => d === "dropClose" || d === "strayOpen").length
      const legacy =
        c.intact.length === 0 &&
        lone > 0 &&
        c.damage.every((d) => d === "dropClose" || d === "strayOpen" || d === "dropPair")
      if (footers > 1 || (c.damage.some((d) => MALFORMING.has(d)) && !legacy)) {
        expect(result.kind, why).toBe("malformed")
        seen.malformed++
        continue
      }
      expect(result.kind, why).toBe("synced")
      if (result.kind !== "synced") continue
      const input = c.lines.map((l) => l.text)
      if (legacy) {
        // old format: only missing sections, as one block, nothing else moves
        seen.legacy++
        const out = result.text.split("\n")
        let i = 0
        while (i < input.length && out[i] === input[i]) i++
        const tail = input.length - i
        expect(out.slice(out.length - tail), why).toEqual(input.slice(i))
        continue
      }
      seen.synced++
      expect(
        blankLinesAdded(
          c.lines.filter((l) => l.user).map((l) => l.text),
          outside(result.text, prefix),
        ),
        why,
      ).toBe(true)
      // every wanted section is there, once, with its content, in wanted order when it was inserted
      const p = parseRegions(result.text, prefix)
      if (!p.ok) throw new Error(why)
      expect(p.regions.map((x) => x.id).toSorted(), why).toEqual(wanted.map((w) => w.id).toSorted())
      const again = syncSections(result.text, prefix, wanted, { footer, owned: () => true })
      expect(again.kind === "synced" && again.text, why).toBe(result.text)
    }
    expect(seen.synced).toBeGreaterThan(CASES / 10)
    expect(seen.malformed).toBeGreaterThan(CASES / 10)
    expect(seen.legacy).toBeGreaterThan(0)
  })
})

describe("marked regions, by example", () => {
  const P = "efforge:section"
  const F = "<!-- efforge:agents -->"
  const sec = (id: string, body: string) => `<!-- ${P}:${id} -->\n\n${body}\n\n<!-- /${P}:${id} -->`

  it("a section that no longer holds is removed, with the blank line that separated it", () => {
    const text = `# A\n\nmine\n\n${sec("db", "## DB")}\n\n${sec("db-wrangler", "- wrangler")}\n\n${sec("email", "## Email")}\n\n${F}\n`
    const out = syncSections(
      text,
      P,
      [
        { id: "db", content: "## DB" },
        { id: "db-alchemy", content: "- alchemy" },
        { id: "email", content: "## Email" },
      ],
      {
        footer: F,
        owned: () => true,
      },
    )
    expect(out).toEqual({
      kind: "synced",
      added: ["db-alchemy"],
      text: `# A\n\nmine\n\n${sec("db", "## DB")}\n\n${sec("db-alchemy", "- alchemy")}\n\n${sec("email", "## Email")}\n\n${F}\n`,
    })
  })

  it("a section of an id no add-on writes is the user's", () => {
    const text = `${sec("mine", "## Mine")}\n\n${F}\n`
    const out = syncSections(text, P, [], { footer: F, owned: (id) => id !== "mine" })
    expect(out).toEqual({ kind: "synced", added: [], text })
  })

  it("names the marker that is wrong", () => {
    const text =
      "<!-- efforge:readme:run -->\na\n<!-- efforge:readme:run -->\nb\n<!-- /efforge:readme:run -->\n"
    expect(fillRegions(text, "efforge:readme", { run: "x" })).toEqual({
      kind: "malformed",
      problems: ["<!-- efforge:readme:run --> appears 2 times (lines 1, 3)"],
    })
  })
})
