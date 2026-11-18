/**
 * Marked regions in a text file efforge shares with its user (README.md, AGENTS.md): the lines
 * between `<!-- <prefix>:<id> -->` and `<!-- /<prefix>:<id> -->`. Inside a region the text is
 * efforge's; every byte outside one is the user's and is never lost, duplicated or reordered.
 *
 * A marker counts only on a line of its own (a marker quoted in a sentence is prose). Each id has
 * exactly one opening and one closing marker, the opening first, and regions don't nest. When any
 * region breaks those rules the file is malformed: nothing in it is rewritten, and the problems say
 * which marker is wrong, so the user can fix it.
 */

export interface Region {
  readonly id: string
  /** 0-based line index of the opening marker. */
  readonly open: number
  /** 0-based line index of the closing marker. */
  readonly close: number
}

export type Parsed =
  | {
      readonly ok: true
      readonly lines: ReadonlyArray<string>
      readonly eol: "\n" | "\r\n"
      /** Well-formed regions, in file order. */
      readonly regions: ReadonlyArray<Region>
      /** Ids that have an opening marker and no closing one anywhere (legacy AGENTS.md sections). */
      readonly openOnly: ReadonlyArray<Region>
    }
  | { readonly ok: false; readonly problems: ReadonlyArray<string> }

export const openMarker = (prefix: string, id: string) => `<!-- ${prefix}:${id} -->`
export const closeMarker = (prefix: string, id: string) => `<!-- /${prefix}:${id} -->`

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** The file's line ending: CRLF when most of its line breaks are. */
const eolOf = (text: string): "\n" | "\r\n" => {
  const breaks = (text.match(/\n/g) ?? []).length
  const crlf = (text.match(/\r\n/g) ?? []).length
  return breaks > 0 && crlf * 2 > breaks ? "\r\n" : "\n"
}

/**
 * Splits `text` into lines (each without its `\n`; a CRLF line keeps its `\r`) and finds the marker
 * lines of `prefix`. With `allowOpenOnly`, an id that has opening markers and no closing marker at
 * all is reported in `openOnly` instead of as a problem (only one opening marker is allowed).
 */
export const parseRegions = (
  text: string,
  prefix: string,
  o: { readonly allowOpenOnly?: boolean } = {},
): Parsed => {
  const lines = text.split("\n")
  const pattern = new RegExp(`^\\s*<!-- (/?)${escape(prefix)}:([A-Za-z0-9_-]+) -->\\s*$`)
  const opens = new Map<string, number[]>()
  const closes = new Map<string, number[]>()
  const order: string[] = []
  lines.forEach((line, i) => {
    const m = pattern.exec(line)
    if (m === null) return
    const id = m[2] as string
    if (!opens.has(id) && !closes.has(id)) order.push(id)
    const into = m[1] === "/" ? closes : opens
    into.set(id, [...(into.get(id) ?? []), i])
  })
  const problems: string[] = []
  const at = (is: ReadonlyArray<number>) =>
    is.length === 1 ? `line ${(is[0] as number) + 1}` : `lines ${is.map((i) => i + 1).join(", ")}`
  const regions: Region[] = []
  const openOnly: Region[] = []
  for (const id of order) {
    const o1 = opens.get(id) ?? []
    const c1 = closes.get(id) ?? []
    const open = openMarker(prefix, id)
    const close = closeMarker(prefix, id)
    if (o1.length > 1) problems.push(`${open} appears ${o1.length} times (${at(o1)})`)
    if (c1.length > 1) problems.push(`${close} appears ${c1.length} times (${at(c1)})`)
    if (o1.length > 1 || c1.length > 1) continue
    const [oi] = o1
    const [ci] = c1
    if (oi !== undefined && ci === undefined) {
      if (o.allowOpenOnly === true) openOnly.push({ id, open: oi, close: oi })
      else problems.push(`${open} (line ${oi + 1}) has no ${close}`)
    } else if (oi === undefined && ci !== undefined)
      problems.push(`${close} (line ${ci + 1}) has no ${open} before it`)
    else if (oi !== undefined && ci !== undefined) {
      if (ci < oi) problems.push(`${close} (line ${ci + 1}) comes before ${open} (line ${oi + 1})`)
      else regions.push({ id, open: oi, close: ci })
    }
  }
  regions.sort((a, b) => a.open - b.open)
  for (let i = 1; i < regions.length; i++) {
    const outer = regions[i - 1] as Region
    const inner = regions[i] as Region
    if (inner.open < outer.close)
      problems.push(
        `${openMarker(prefix, inner.id)} (line ${inner.open + 1}) is inside the ${outer.id} region (lines ${outer.open + 1}-${outer.close + 1})`,
      )
  }
  // an open-only marker inside a region would be swallowed by a rewrite of that region
  for (const lone of openOnly)
    for (const r of regions)
      if (lone.open > r.open && lone.open < r.close)
        problems.push(
          `${openMarker(prefix, lone.id)} (line ${lone.open + 1}) is inside the ${r.id} region (lines ${r.open + 1}-${r.close + 1})`,
        )
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, lines, eol: eolOf(text), regions, openOnly }
}

/** `content` as the lines of a region body: a blank line, the content, a blank line. */
const body = (content: string, eol: string): string[] => {
  const cr = eol === "\r\n" ? "\r" : ""
  return ["", ...content.trim().split(/\r?\n/), ""].map((l) => `${l}${cr}`)
}

/** The marker line `marker` written the way the file writes its lines. */
const line = (marker: string, eol: string) => `${marker}${eol === "\r\n" ? "\r" : ""}`

export type Filled =
  | { readonly kind: "filled"; readonly text: string }
  | { readonly kind: "no-markers" }
  | { readonly kind: "malformed"; readonly problems: ReadonlyArray<string> }

/**
 * `text` with the body of each region whose id is in `contents` replaced. Regions with other ids,
 * and every line outside the regions, are kept as they are.
 */
export const fillRegions = (
  text: string,
  prefix: string,
  contents: Readonly<Record<string, string>>,
): Filled => {
  const parsed = parseRegions(text, prefix)
  if (!parsed.ok) return { kind: "malformed", problems: parsed.problems }
  if (parsed.regions.length === 0) return { kind: "no-markers" }
  const out: string[] = []
  let from = 0
  for (const r of parsed.regions) {
    const content = contents[r.id]
    if (content === undefined) continue
    out.push(...parsed.lines.slice(from, r.open + 1), ...body(content, parsed.eol))
    from = r.close
  }
  out.push(...parsed.lines.slice(from))
  return { kind: "filled", text: out.join("\n") }
}

export interface Section {
  readonly id: string
  readonly content: string
}

export type Synced =
  | { readonly kind: "synced"; readonly text: string; readonly added: ReadonlyArray<string> }
  | { readonly kind: "malformed"; readonly problems: ReadonlyArray<string> }

/**
 * Brings the sections of `text` (regions of `prefix`) to `wanted`, an ordered list: each wanted
 * section's body is rewritten, a missing one is inserted next to its neighbours in `wanted` (else
 * before the `footer` line, else at the end), and a section of an id in `owned` that is no longer
 * wanted is removed. Sections of other ids are the user's.
 *
 * A file whose sections have opening markers only (written before sections had closing markers)
 * can't be rewritten without guessing where a section ends: it only gets the missing sections,
 * written the same way, before the footer.
 */
export const syncSections = (
  text: string,
  prefix: string,
  wanted: ReadonlyArray<Section>,
  o: { readonly footer: string; readonly owned: (id: string) => boolean },
): Synced => {
  const parsed = parseRegions(text, prefix, { allowOpenOnly: true })
  if (!parsed.ok) return { kind: "malformed", problems: parsed.problems }
  const { lines, eol } = parsed
  const legacy = parsed.openOnly.length > 0
  if (legacy && parsed.regions.length > 0)
    return {
      kind: "malformed",
      problems: parsed.openOnly.map(
        (r) =>
          `${openMarker(prefix, r.id)} (line ${r.open + 1}) has no ${closeMarker(prefix, r.id)}`,
      ),
    }
  const footers = lines.flatMap((l, i) => (l.trim() === o.footer ? [i] : []))
  if (footers.length > 1)
    return {
      kind: "malformed",
      problems: [
        `${o.footer} appears ${footers.length} times (lines ${footers.map((i) => i + 1).join(", ")})`,
      ],
    }
  const footer = footers[0]
  const holder = parsed.regions.find(
    (r) => footer !== undefined && footer > r.open && footer < r.close,
  )
  if (holder !== undefined)
    return {
      kind: "malformed",
      problems: [`${o.footer} (line ${(footer as number) + 1}) is inside the ${holder.id} region`],
    }
  const present = new Map([...parsed.regions, ...parsed.openOnly].map((r) => [r.id, r] as const))
  const missing = wanted.filter((s) => !present.has(s.id))
  const added = missing.map((s) => s.id)

  if (legacy) {
    if (missing.length === 0) return { kind: "synced", text, added }
    const block = missing.flatMap((s) => [
      line(openMarker(prefix, s.id), eol),
      ...body(s.content, eol),
    ])
    return { kind: "synced", text: insertAt(lines, footer, block, eol).join("\n"), added }
  }

  // what goes before line i: blocks inserted there, by line index
  const before = new Map<number, string[][]>()
  const after = new Map<number, string[][]>()
  const at = (into: Map<number, string[][]>, i: number, block: string[]) =>
    into.set(i, [...(into.get(i) ?? []), block])
  const blockOf = (s: Section) => [
    line(openMarker(prefix, s.id), eol),
    ...body(s.content, eol),
    line(closeMarker(prefix, s.id), eol),
  ]
  const tail: string[][] = []
  wanted.forEach((s, i) => {
    if (present.has(s.id)) return
    const next = wanted.slice(i + 1).find((n) => present.has(n.id))
    const prev = wanted
      .slice(0, i)
      .toReversed()
      .find((p) => present.has(p.id))
    if (next !== undefined) at(before, (present.get(next.id) as Region).open, blockOf(s))
    else if (prev !== undefined) at(after, (present.get(prev.id) as Region).close, blockOf(s))
    else if (footer !== undefined) at(before, footer, blockOf(s))
    else tail.push(blockOf(s))
  })
  // `after` a region keeps wanted order: later sections come later
  const wantedIds = new Map(wanted.map((s) => [s.id, s] as const))
  const regionAt = new Map(parsed.regions.map((r) => [r.open, r] as const))
  const out: string[] = []
  const blank = (l: string | undefined) => l === undefined || l.trim() === ""
  const push = (block: string[]) => {
    if (!blank(out[out.length - 1])) out.push(eol === "\r\n" ? "\r" : "")
    out.push(...block)
  }
  let i = 0
  while (i < lines.length) {
    for (const block of before.get(i) ?? []) {
      push(block)
      out.push(eol === "\r\n" ? "\r" : "")
    }
    const r = regionAt.get(i)
    if (r === undefined) {
      out.push(lines[i] as string)
      i++
      continue
    }
    const want = wantedIds.get(r.id)
    if (want !== undefined) {
      out.push(lines[r.open] as string, ...body(want.content, eol), lines[r.close] as string)
    } else if (!o.owned(r.id)) {
      out.push(...lines.slice(r.open, r.close + 1))
    } else {
      // removed: drop the blank line that separated it, so no blank lines pile up
      if (blank(out[out.length - 1]) && blank(lines[r.close + 1]) && r.close + 1 < lines.length)
        i = r.close + 2
      else i = r.close + 1
      continue
    }
    const following = after.get(r.close) ?? []
    for (const block of following) push(block)
    if (following.length > 0 && !blank(lines[r.close + 1])) out.push(eol === "\r\n" ? "\r" : "")
    i = r.close + 1
  }
  if (tail.length > 0) {
    // keep a final newline where the file had one
    const final = out[out.length - 1] === ""
    if (final) out.pop()
    for (const block of tail) push(block)
    if (final) out.push("")
  }
  return { kind: "synced", text: out.join("\n"), added }
}

/** `block` inserted before line `at` (else at the end), with a blank line on each side. */
const insertAt = (
  lines: ReadonlyArray<string>,
  at: number | undefined,
  block: ReadonlyArray<string>,
  eol: string,
): string[] => {
  const blankLine = eol === "\r\n" ? "\r" : ""
  const isBlank = (l: string | undefined) => l === undefined || l.trim() === ""
  if (at === undefined) {
    const final = lines[lines.length - 1] === ""
    const head = final ? lines.slice(0, -1) : [...lines]
    return [
      ...head,
      ...(isBlank(head[head.length - 1]) ? [] : [blankLine]),
      ...block.slice(0, -1),
      ...(final ? [""] : []),
    ]
  }
  const head = lines.slice(0, at)
  return [
    ...head,
    ...(isBlank(head[head.length - 1]) ? [] : [blankLine]),
    ...block,
    ...lines.slice(at),
  ]
}
