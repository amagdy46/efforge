// Text to SVG path data with the brand fonts (opentype.js and the @fontsource dev dependencies),
// so outlined text renders the same everywhere. Used by outline.ts and scripts/docs/diagram.ts.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

export interface Command {
  readonly type: "M" | "L" | "Q" | "C" | "Z"
  readonly x: number
  readonly y: number
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}
export interface Glyph {
  readonly advanceWidth: number
  getPath(x: number, y: number, size: number): { readonly commands: ReadonlyArray<Command> }
}
export interface Font {
  readonly unitsPerEm: number
  readonly tables: { readonly os2: { readonly sxHeight: number } }
  charToGlyph(ch: string): Glyph
  getKerningValue(a: Glyph, b: Glyph): number
}
const opentype = createRequire(import.meta.url)("opentype.js") as {
  parse(buf: ArrayBuffer): Font
}

export const fonts = {
  saira: (weight: number) =>
    `@fontsource/saira-semi-condensed/files/saira-semi-condensed-latin-${weight}-normal.woff`,
  mono: (weight: number) =>
    `@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${weight}-normal.woff`,
}
// opentype.js 2.0's own toPathData sometimes prints NaN, so path data is written here,
// in the same format: two decimals, whole numbers without them.
const num = (v: number) => {
  const r = Math.round(v * 100) / 100
  return Number.isInteger(r) ? String(r === 0 ? 0 : r) : r.toFixed(2)
}
const pack = (vs: ReadonlyArray<number>) =>
  vs.map((v, i) => (i > 0 && v >= 0 ? " " : "") + num(v)).join("")
// Like opentype's optimized output: no repeated points, and subpaths close implicitly.
export const pathData = (g: Glyph, x: number, y: number, size: number) => {
  let d = ""
  let px = NaN
  let py = NaN
  let sx = NaN
  let sy = NaN
  const cmds = g.getPath(x, y, size).commands
  for (const [i, c] of cmds.entries()) {
    if (c.type === "Z") continue
    if (c.type === "M") {
      sx = c.x
      sy = c.y
    }
    const same = (ax: number, ay: number) => num(c.x) === num(ax) && num(c.y) === num(ay)
    if (c.type === "L" && (same(px, py) || ((cmds[i + 1]?.type ?? "Z") === "Z" && same(sx, sy))))
      continue
    const vs =
      c.type === "Q"
        ? [c.x1, c.y1, c.x, c.y]
        : c.type === "C"
          ? [c.x1, c.y1, c.x2, c.y2, c.x, c.y]
          : [c.x, c.y]
    d += c.type + pack(vs)
    px = c.x
    py = c.y
  }
  return d
}

export const load = (file: string): Font => {
  const buf = readFileSync(createRequire(import.meta.url).resolve(file))
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}

/** Lays `text` out at `size` px on a baseline at y = 0, with kerning and optional tracking. */
export const outline = (font: Font, text: string, size: number, tracking = 0) => {
  let x = 0
  let d = ""
  let prev: Glyph | undefined
  for (const ch of text) {
    const g = font.charToGlyph(ch)
    if (prev) x += (font.getKerningValue(prev, g) * size) / font.unitsPerEm
    d += pathData(g, x, 0, size)
    x += (g.advanceWidth * size) / font.unitsPerEm + tracking
    prev = g
  }
  return { text, width: Math.round((x - tracking) * 100) / 100, d }
}
