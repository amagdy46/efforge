// `pnpm docs:diagram`: writes the diagram in docs/architecture.md, docs/assets/layers-light.svg and
// layers-dark.svg. One layout, 520 wide, for desktops and phones alike: no text is smaller than
// 17 px, so in a 380 px viewport (the image about 348 px wide) the smallest is 11 px. Colours come
// from scripts/brand/source.ts: the tempering colours in order, one per part (interface, layer,
// composition, test layer). Text is outlined with the brand fonts, so it renders the same on every
// machine; each glyph is drawn once and reused. test/docs.test.ts fails while a file is stale, and
// checks that the page's text list names every label in `diagramText`.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { type Font, fonts, type Glyph, load, pathData } from "../brand/glyphs.ts"
import { palette } from "../brand/source.ts"

const root = fileURLToPath(new URL("../..", import.meta.url))

const faces = {
  label: load(fonts.saira(500)),
  heading: load(fonts.saira(600)),
  digit: load(fonts.saira(700)),
  code: load(fonts.mono(500)),
  title: load(fonts.mono(700)),
}
type Face = keyof typeof faces

type Mode = "light" | "dark"
interface Theme {
  readonly ink: string
  readonly paper: string
  readonly tint: number
  readonly straw: string
  readonly bronze: string
  readonly purple: string
  readonly blued: string
}

const themes: Record<Mode, Theme> = {
  light: {
    ink: palette.iron.hex,
    paper: palette.paper.hex,
    tint: 0.2,
    straw: palette.straw.hex,
    bronze: palette.bronze.hex,
    purple: palette.purple.hex,
    blued: palette.blued.hex,
  },
  dark: {
    ink: palette.paper.hex,
    paper: palette.iron.hex,
    tint: 0.16,
    straw: palette.straw.hex,
    bronze: palette.bronze.hex,
    purple: palette.purple.dark,
    blued: palette.blued.dark,
  },
}

/** Every label in the diagram that names something; the page's text list must contain each. */
export const diagramText = {
  steps: ["The interface", "A layer", "One file composes", "A test swaps the layer"],
  names: [
    "Notes",
    "list",
    "insert(title)",
    "NotesUnavailable",
    "createNote",
    "NotesLive",
    "AppLayer",
    "DatabaseLayer",
    "AuthLive",
    "NotesInMemory",
    "layer(NotesInMemory)",
  ],
  files: [
    "packages/core/src/notes.ts",
    "packages/db/src/notes.ts",
    "apps/web/src/server/layers.ts",
    "packages/core/test/notes.test.ts",
  ],
} as const

const [interfaceFile, layerFile, layersFile, testFile] = diagramText.files
const [stepInterface, stepLayer, stepCompose] = diagramText.steps

const title = "A service, a layer, one file that composes the layers, and a test that swaps one"
const desc =
  "1. The interface: Notes, in packages/core/src/notes.ts, has list and insert(title), which can fail with NotesUnavailable. createNote asks for Notes and never sees a layer. " +
  "2. A layer: NotesLive, in packages/db/src/notes.ts, implements Notes with queries on the note table. " +
  "3. One file composes: AppLayer, in apps/web/src/server/layers.ts, lists DatabaseLayer, which holds NotesLive, and AuthLive. " +
  "4. A test swaps the layer: in packages/core/test/notes.test.ts, NotesInMemory also implements Notes and keeps notes in memory; layer(NotesInMemory) provides it in place of NotesLive."

const round = (n: number) => Math.round(n * 100) / 100

/** The smallest text in the diagram, in px at its natural width (code; labels are larger). */
const SMALL = 17
/** Saira Semi Condensed is narrow and short for its size, so labels are set larger than code. */
const LABEL = 18
const MUTED = 0.8

/** Drawing helpers over one theme; `svg()` wraps what was drawn. */
const canvas = (t: Theme) => {
  const out: string[] = []
  const glyphs = new Map<string, string>()

  const measure = (f: Face, s: string, size: number) => {
    const font: Font = faces[f]
    let x = 0
    let prev: Glyph | undefined
    const placed: Array<{ id: string; x: number }> = []
    for (const ch of s) {
      const g = font.charToGlyph(ch)
      if (prev) x += (font.getKerningValue(prev, g) * size) / font.unitsPerEm
      const id = `${f}${size}-${ch.codePointAt(0)}`
      if (!glyphs.has(id)) glyphs.set(id, pathData(g, 0, 0, size))
      if (glyphs.get(id) !== "") placed.push({ id, x })
      x += (g.advanceWidth * size) / font.unitsPerEm
      prev = g
    }
    return { width: x, placed }
  }

  /** Text with its baseline at `y`; throws if it is smaller than SMALL or wider than `max`. */
  const text = (
    s: string,
    x: number,
    y: number,
    f: Face,
    size: number,
    o: { fill?: string; muted?: boolean; middle?: boolean; max?: number } = {},
  ) => {
    if (size < SMALL) throw new Error(`"${s}" is ${size} px; the smallest text is ${SMALL} px`)
    const { width, placed } = measure(f, s, size)
    if (o.max !== undefined && width > o.max)
      throw new Error(`"${s}" is ${round(width)} px wide; it has ${o.max} px`)
    const left = o.middle === true ? x - width / 2 : x
    const fill = o.fill ?? t.ink
    out.push(
      `<g fill="${fill}"${o.muted === true ? ` fill-opacity="${MUTED}"` : ""}>${placed
        .map((p) => `<use href="#${p.id}" x="${round(left + p.x)}" y="${y}"/>`)
        .join("")}</g>`,
    )
  }

  const box = (x: number, y: number, w: number, h: number, colour: string) =>
    out.push(
      `<rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" rx="6" fill="${colour}" fill-opacity="${t.tint}" stroke="${colour}" stroke-width="2"/>`,
    )

  const badge = (n: number, cx: number, cy: number) => {
    out.push(`<circle cx="${cx}" cy="${cy}" r="13" fill="${t.ink}"/>`)
    text(String(n), cx, cy + 6, "digit", 17, { fill: t.paper, middle: true })
  }

  const chip = (x: number, y: number, w: number, name: string, colour?: string) => {
    out.push(
      colour === undefined
        ? `<rect x="${x + 0.75}" y="${y + 0.75}" width="${w - 1.5}" height="30.5" rx="4" fill="none" stroke="${t.ink}" stroke-opacity="0.4" stroke-width="1.5"/>`
        : `<rect x="${x}" y="${y}" width="${w}" height="32" rx="4" fill="${colour}" fill-opacity="${t.tint}" stroke="${colour}" stroke-width="1.5"/>`,
    )
    text(name, x + 12, y + 22, "code", SMALL, { max: w - 24 })
  }

  /** A labelled vertical arrow at x from y1 to y2; the label sits to its right. */
  const arrow = (x: number, y1: number, y2: number, label: string) => {
    const by = y2 - Math.sign(y2 - y1) * 10
    out.push(
      `<line x1="${x}" y1="${y1}" x2="${x}" y2="${by}" stroke="${t.ink}" stroke-width="1.75"/>`,
      `<polygon points="${x},${y2} ${x - 6},${by} ${x + 6},${by}" fill="${t.ink}"/>`,
    )
    text(label, x + 12, (y1 + y2) / 2 + 6, "label", LABEL, { muted: true })
  }

  const svg = (w: number, h: number) => {
    const defs = [...glyphs]
      .filter(([, d]) => d !== "")
      .map(([id, d]) => `<path id="${id}" d="${d}"/>`)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title desc">
<title id="title">${title}</title>
<desc id="desc">${desc}</desc>
<defs>
${defs.join("\n")}
</defs>
${out.join("\n")}
</svg>
`
  }

  return { measure, text, box, badge, chip, arrow, svg }
}

const W = 520
const M = 16 // outer margin
const GAP = 24 // between the two columns
const COL = (W - 2 * M - GAP) / 2
const PAD = 14 // inside a box
const LINE = 24 // line height
const ARROW = 64 // room for an arrow and its label between rows

/**
 * The interface across the top. Under it two columns that mirror each other: the app on the left
 * (the layer, then the file that composes it), the test on the right (the test layer, then what
 * provides it). Both layers point up at the one interface.
 */
const layout = (t: Theme) => {
  const c = canvas(t)
  const left = M
  const right = M + COL + GAP
  const inner = COL - 2 * PAD
  const wide = W - 2 * M - 2 * PAD

  /** The step's badge and name, on one line or two. */
  const heading = (n: number, x: number, y: number, lines: ReadonlyArray<string>) => {
    c.badge(n, x + PAD + 13, y + 29)
    lines.forEach((l, i) =>
      c.text(l, x + PAD + 34, y + 36 + i * LINE, "heading", 20, { max: COL - 2 * PAD - 34 }),
    )
  }
  /** A file path at the bottom of a box, split after its last slash when it does not fit. */
  const path = (x: number, bottom: number, file: string, width: number) => {
    const fits = c.measure("code", file, SMALL).width <= width
    const cut = file.lastIndexOf("/") + 1
    const lines = fits ? [file] : [file.slice(0, cut), file.slice(cut)]
    lines.forEach((l, i) =>
      c.text(l, x + PAD, bottom - PAD - (lines.length - 1 - i) * LINE, "code", SMALL, {
        muted: true,
        max: width,
      }),
    )
  }
  const label = (s: string, x: number, y: number, muted = false) =>
    c.text(s, x + PAD, y, "label", LABEL, { muted, max: inner })

  // 1. the interface, across the top
  const top = { y: M, h: 212 }
  c.box(M, top.y, W - 2 * M, top.h, t.straw)
  heading(1, M, top.y, [stepInterface])
  c.text("Notes", M + PAD, top.y + 72, "title", 20)
  c.text("list, insert(title)", M + PAD, top.y + 100, "code", SMALL)
  c.text("can fail with NotesUnavailable", M + PAD, top.y + 126, "label", LABEL)
  c.text(
    "createNote asks for Notes and never sees a layer.",
    M + PAD,
    top.y + 152,
    "label",
    LABEL,
    {
      muted: true,
      max: wide,
    },
  )
  path(M, top.y + top.h, interfaceFile, wide)

  // 2 and 4: the layer and the test layer, side by side
  const row2 = { y: top.y + top.h + ARROW, h: 220 }
  c.box(left, row2.y, COL, row2.h, t.bronze)
  heading(2, left, row2.y, [stepLayer])
  c.text("NotesLive", left + PAD, row2.y + 94, "title", 20, { max: inner })
  label("queries the note", left, row2.y + 124)
  label("table with Drizzle", left, row2.y + 124 + LINE)
  path(left, row2.y + row2.h, layerFile, inner)

  c.box(right, row2.y, COL, row2.h, t.blued)
  heading(4, right, row2.y, ["A test swaps", "the layer"])
  c.text("NotesInMemory", right + PAD, row2.y + 94, "title", 20, { max: inner })
  label("keeps notes in a", right, row2.y + 124)
  label("list in memory", right, row2.y + 124 + LINE)
  path(right, row2.y + row2.h, testFile, inner)

  // 3: the file that composes the layers, and what provides the test layer
  const row3 = { y: row2.y + row2.h + ARROW, h: 260 }
  c.box(left, row3.y, COL, row3.h, t.purple)
  heading(3, left, row3.y, [stepCompose])
  c.text("AppLayer", left + PAD, row3.y + 74, "title", 20)
  c.chip(left + PAD, row3.y + 92, inner, "DatabaseLayer", t.bronze)
  label("holds NotesLive", left + 12, row3.y + 148, true)
  c.chip(left + PAD, row3.y + 162, inner, "AuthLive")
  path(left, row3.y + row3.h, layersFile, inner)

  const provides = { y: row3.y, h: 172 }
  c.box(right, provides.y, COL, provides.h, t.blued)
  c.text("layer(NotesInMemory)", right + PAD, provides.y + 38, "title", SMALL, { max: inner })
  label("runs createNote with", right, provides.y + 72)
  label("the test layer", right, provides.y + 72 + LINE)
  path(right, provides.y + provides.h, testFile, inner)

  const ax = (x: number) => x + PAD + 13 // under the step badges
  c.arrow(ax(left), row2.y, top.y + top.h, "implements")
  c.arrow(ax(right), row2.y, top.y + top.h, "implements")
  c.arrow(ax(left), row2.y + row2.h, row3.y, "listed in")
  c.arrow(ax(right), row2.y + row2.h, provides.y, "provided by")
  return c.svg(W, row3.y + row3.h + M)
}

export const diagramFiles = (): Map<string, string> =>
  new Map([
    ["docs/assets/layers-light.svg", layout(themes.light)],
    ["docs/assets/layers-dark.svg", layout(themes.dark)],
  ])

if (import.meta.main) {
  for (const [path, body] of diagramFiles()) {
    const file = join(root, path)
    if (existsSync(file) && readFileSync(file, "utf8") === body) continue
    writeFileSync(file, body)
    console.log(`wrote ${path}`)
  }
}
