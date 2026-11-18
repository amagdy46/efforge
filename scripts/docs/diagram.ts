// `pnpm docs:diagram`: writes the diagram in docs/architecture.md, docs/assets/layers-*.svg: a wide
// layout (800 px and up) and a narrow one for phones, each in light and dark. Colours come from
// scripts/brand/source.ts: the tempering colours in order, one per part (interface, layer,
// composition, test layer). Text is outlined with the brand fonts, so it renders the same on every
// machine; each glyph is drawn once and reused. test/docs.test.ts fails while a file is stale.
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

const round = (n: number) => Math.round(n * 100) / 100

interface Row {
  readonly y: number
  readonly h: number
}
type Line = string | { readonly code: string }

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

  const text = (
    s: string,
    x: number,
    y: number,
    f: Face,
    size: number,
    o: { fill?: string; muted?: boolean; middle?: boolean } = {},
  ) => {
    const { width, placed } = measure(f, s, size)
    const left = o.middle === true ? x - width / 2 : x
    const fill = o.fill ?? t.ink
    out.push(
      `<g fill="${fill}"${o.muted === true ? ' fill-opacity="0.72"' : ""}>${placed
        .map((p) => `<use href="#${p.id}" x="${round(left + p.x)}" y="${y}"/>`)
        .join("")}</g>`,
    )
  }

  const box = (x: number, y: number, w: number, h: number, colour: string) =>
    out.push(
      `<rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" rx="6" fill="${colour}" fill-opacity="${t.tint}" stroke="${colour}" stroke-width="2"/>`,
    )

  const badge = (n: number, cx: number, cy: number) => {
    out.push(`<circle cx="${cx}" cy="${cy}" r="12" fill="${t.ink}"/>`)
    text(String(n), cx, cy + 5.5, "digit", 15, { fill: t.paper, middle: true })
  }

  const chip = (x: number, y: number, w: number, name: string, colour?: string) => {
    out.push(
      colour === undefined
        ? `<rect x="${x + 0.75}" y="${y + 0.75}" width="${w - 1.5}" height="26.5" rx="4" fill="none" stroke="${t.ink}" stroke-opacity="0.35" stroke-width="1.5"/>`
        : `<rect x="${x}" y="${y}" width="${w}" height="28" rx="4" fill="${colour}" fill-opacity="${t.tint}" stroke="${colour}" stroke-width="1.5"/>`,
    )
    text(name, x + 12, y + 19, "code", 14)
  }

  /** A part: optional step number, its name, up to three lines, and optionally its file. */
  const part = (
    x: number,
    w: number,
    row: Row,
    colour: string,
    p: { step?: number; name: string; size?: number; lines: ReadonlyArray<Line>; file?: string },
  ) => {
    box(x, row.y, w, row.h, colour)
    let left = x + 16
    if (p.step !== undefined) {
      badge(p.step, x + 28, row.y + 28)
      left = x + 48
    }
    text(p.name, left, row.y + 35, "title", p.size ?? 20)
    p.lines.forEach((l, i) => {
      const y = row.y + 64 + i * 22
      if (typeof l === "string") text(l, x + 16, y, "label", 16)
      else text(l.code, x + 16, y, "code", 15)
    })
    if (p.file !== undefined) text(p.file, x + 16, row.y + row.h - 16, "code", 13, { muted: true })
  }

  /** A labelled arrow from (x1, y1) to (x2, y2); horizontal or vertical. */
  const arrow = (x1: number, y1: number, x2: number, y2: number, label: string) => {
    const dx = Math.sign(x2 - x1)
    const dy = Math.sign(y2 - y1)
    const bx = x2 - dx * 9
    const by = y2 - dy * 9
    const wing = (a: number, b: number) => (dx === 0 ? `${a + b},${by}` : `${bx},${a + b}`)
    const across = dx === 0 ? x2 : y2
    out.push(
      `<line x1="${x1}" y1="${y1}" x2="${bx}" y2="${by}" stroke="${t.ink}" stroke-width="1.5"/>`,
      `<polygon points="${x2},${y2} ${wing(across, -5)} ${wing(across, 5)}" fill="${t.ink}"/>`,
    )
    if (dx === 0) text(label, x1 + 10, (y1 + y2) / 2 + 5, "label", 14, { muted: true })
    else text(label, (x1 + x2) / 2, y1 - 9, "label", 14, { muted: true, middle: true })
  }

  const svg = (w: number, h: number) => {
    const title = "A service, a layer, one file that composes the layers, and a test that swaps one"
    const desc =
      "1. The Mailer interface in packages/core/src/mailer.ts: send(message), which fails with MailerError. Your code asks for Mailer and never sees a layer. " +
      "2. MailerLive in apps/web/src/server/mailer.ts implements Mailer by sending through the EMAIL binding. " +
      "3. MailerLive is listed in AppLayer, next to DatabaseLayer and AuthLive, in apps/web/src/server/layers.ts. " +
      "4. In a test, MailerTest also implements Mailer and keeps messages in an array; layer(MailerTest) provides it instead of MailerLive."
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

  return { text, box, badge, chip, part, arrow, svg }
}

/** 840 wide: three columns (interface, layer, composition), the test row under the app row. */
const wide = (t: Theme) => {
  const c = canvas(t)
  const col = [24, 320, 616] as const
  const w = 200
  const rowA: Row = { y: 88, h: 188 }
  const rowB: Row = { y: 368, h: 136 }

  const step = (n: number, x: number, y: number, heading: string, dir: string) => {
    c.badge(n, x + 12, y)
    c.text(heading, x + 32, y + 6, "heading", 18)
    c.text(dir, x, y + 32, "code", 13, { muted: true })
  }
  step(1, col[0], 36, "The interface", "packages/core/src")
  step(2, col[1], 36, "A layer", "apps/web/src/server")
  step(3, col[2], 36, "One file composes", "apps/web/src/server")
  step(4, col[1], rowB.y - 52, "A test swaps the layer", "packages/core/test")

  const mailer: Row = { y: rowA.y, h: rowB.y + rowB.h - rowA.y }
  c.part(col[0], w, mailer, t.straw, {
    name: "Mailer",
    lines: [{ code: "send(message)" }, "fails with MailerError"],
    file: "mailer.ts",
  })
  const note = ["Your code asks for", "Mailer and never", "sees a layer."]
  note.forEach((l, i) => c.text(l, col[0] + 16, 296 + i * 22, "label", 16, { muted: true }))

  c.part(col[1], w, rowA, t.bronze, {
    name: "MailerLive",
    lines: ["sends through the", "EMAIL binding"],
    file: "mailer.ts",
  })

  c.box(col[2], rowA.y, w, rowA.h, t.purple)
  c.text("AppLayer", col[2] + 16, rowA.y + 35, "title", 20)
  const chipY = (i: number) => rowA.y + 52 + i * 36
  c.chip(col[2] + 16, chipY(0), w - 32, "DatabaseLayer")
  c.chip(col[2] + 16, chipY(1), w - 32, "AuthLive")
  c.chip(col[2] + 16, chipY(2), w - 32, "MailerLive", t.bronze)
  c.text("layers.ts", col[2] + 16, rowA.y + rowA.h - 16, "code", 13, { muted: true })

  c.part(col[1], w, rowB, t.blued, {
    name: "MailerTest",
    lines: ["keeps messages", "in an array"],
    file: "mailer.test.ts",
  })
  c.part(col[2], w, rowB, t.blued, {
    name: "layer(MailerTest)",
    size: 16,
    lines: ["runs your code with", "the test layer"],
    file: "mailer.test.ts",
  })

  const lineA = chipY(2) + 14
  const lineB = rowB.y + 52
  c.arrow(col[1], lineA, col[0] + w, lineA, "implements")
  c.arrow(col[1] + w, lineA, col[2] + 16, lineA, "listed in")
  c.arrow(col[1], lineB, col[0] + w, lineB, "implements")
  c.arrow(col[1] + w, lineB, col[2], lineB, "provided by")
  return c.svg(840, 528)
}

/** 440 wide, for phones: the interface on top, the app in the left column, the test in the right. */
const narrow = (t: Theme) => {
  const c = canvas(t)
  const col = [20, 230] as const
  const w = 190
  c.part(col[0], 400, { y: 20, h: 100 }, t.straw, {
    step: 1,
    name: "Mailer",
    lines: [{ code: "send(message)" }, "fails with MailerError"],
  })
  const row2: Row = { y: 184, h: 100 }
  c.part(col[0], w, row2, t.bronze, {
    step: 2,
    name: "MailerLive",
    lines: ["sends through the", "EMAIL binding"],
  })
  c.part(col[1], w, row2, t.blued, {
    step: 4,
    name: "MailerTest",
    lines: ["keeps messages", "in an array"],
  })
  const row3: Row = { y: 348, h: 168 }
  c.box(col[0], row3.y, w, row3.h, t.purple)
  c.badge(3, col[0] + 28, row3.y + 28)
  c.text("AppLayer", col[0] + 48, row3.y + 35, "title", 20)
  c.chip(col[0] + 16, row3.y + 56, w - 32, "DatabaseLayer")
  c.chip(col[0] + 16, row3.y + 92, w - 32, "AuthLive")
  c.chip(col[0] + 16, row3.y + 128, w - 32, "MailerLive", t.bronze)
  c.part(col[1], w, { y: row3.y, h: 100 }, t.blued, {
    name: "layer(MailerTest)",
    size: 16,
    lines: ["runs your code with", "the test layer"],
  })

  const up = 120
  c.arrow(col[0] + 40, row2.y, col[0] + 40, up, "implements")
  c.arrow(col[1] + 40, row2.y, col[1] + 40, up, "implements")
  c.arrow(col[0] + 40, row2.y + row2.h, col[0] + 40, row3.y, "listed in")
  c.arrow(col[1] + 40, row2.y + row2.h, col[1] + 40, row3.y, "provided by")
  return c.svg(440, 536)
}

export const diagramFiles = (): Map<string, string> =>
  new Map([
    ["docs/assets/layers-light.svg", wide(themes.light)],
    ["docs/assets/layers-dark.svg", wide(themes.dark)],
    ["docs/assets/layers-narrow-light.svg", narrow(themes.light)],
    ["docs/assets/layers-narrow-dark.svg", narrow(themes.dark)],
  ])

if (import.meta.main) {
  for (const [path, body] of diagramFiles()) {
    const file = join(root, path)
    if (existsSync(file) && readFileSync(file, "utf8") === body) continue
    writeFileSync(file, body)
    console.log(`wrote ${path}`)
  }
}
