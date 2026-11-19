// Every generated brand asset, as a pure function of source.ts and text.ts.
// build.ts writes them; test/brand.test.ts checks the committed files match.
import { Canvas, encodePng, flatten, type Transform } from "./raster.ts"
import { copy, layerColors, mark, palette, repo, surfaces, temper, wordmark } from "./source.ts"
import { text } from "./text.ts"

export type Asset =
  | { readonly kind: "text"; readonly body: string }
  | { readonly kind: "png"; readonly w: number; readonly h: number; readonly rgba: Uint8Array }

const { iron, paper, blued, steel } = palette

/** The bounding box of path data, rounded out to the mark's grid. */
const gridBox = (...ds: string[]) => {
  const pts = ds.flatMap((d) => flatten(d).flat())
  const xs = pts.map(([x]) => x)
  const ys = pts.map(([, y]) => y)
  const out = (v: number) => Math.ceil(v / mark.cell - 1e-9) * mark.cell
  const inn = (v: number) => Math.floor(v / mark.cell + 1e-9) * mark.cell
  const x = inn(Math.min(...xs))
  const y = inn(Math.min(...ys))
  return { x, y, w: out(Math.max(...xs)) - x, h: out(Math.max(...ys)) - y }
}

/** The lockup's canvas: the mark and the word, rounded out to whole cells. */
const LOCKUP = gridBox(mark.punch, wordmark.d)
/** The ligature's box: the letters alone, on whole cells (8..56 today, so 12 x 12 cells). */
const LIGATURE = gridBox(mark.letters)

// ---- SVG ----------------------------------------------------------------------------------

const svg = (
  w: number,
  h: number,
  body: string,
  label: string,
  size?: [number, number],
  origin: [number, number] = [0, 0],
) =>
  `<svg xmlns="http://www.w3.org/2000/svg"${size ? ` width="${size[0]}" height="${size[1]}"` : ""} viewBox="${origin[0]} ${origin[1]} ${w} ${h}" role="img" aria-label="${label}">${body}</svg>\n`

/** The colour mark: blued-steel punch, paper letters. */
const colourMark = `<path fill="${blued.hex}" d="${mark.punch}"/><path fill="${paper.hex}" fill-rule="evenodd" d="${mark.letters}"/>`
/** The one-colour mark: the punch with the letters cut through it. */
const monoMark = (fill: string) =>
  `<path fill="${fill}" fill-rule="evenodd" d="${mark.punch}${mark.letters}"/>`

const lockupSvg = (word: string) =>
  svg(
    LOCKUP.w,
    LOCKUP.h,
    `${colourMark}<path fill="${word}" d="${wordmark.d}"/>`,
    "efforge",
    undefined,
    [LOCKUP.x, LOCKUP.y],
  )

/** The ef ligature alone, for sizes below 16 px: one colour, cropped to the letters. */
const ligatureSvg = (fill: string) =>
  svg(
    LIGATURE.w,
    LIGATURE.h,
    `<path fill="${fill}" fill-rule="evenodd" d="${mark.letters}"/>`,
    "efforge",
    undefined,
    [LIGATURE.x, LIGATURE.y],
  )

const scaled = (d: string, s: number, x: number, y: number) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="${d}"/>`

/** Opacity of the badge's Steel edge over Iron. */
const BADGE_EDGE = 0.35

/** Shields-height badge: the colour mark at the left, "made with efforge" at the right. */
const BADGE = (() => {
  const s = 11.5 / 100
  const lead = 22 // 2 px, the 16 px mark (one pixel per cell), 4 px
  const pad = 7
  const w = lead + Math.ceil(text.badge.width * s) + pad
  return { s, lead, w, h: 20, baseline: 14 }
})()

const badgeSvg = () => {
  const { s, lead, w, h, baseline } = BADGE
  const body =
    `<title>made with efforge</title>` +
    `<clipPath id="r"><rect width="${w}" height="${h}" rx="3"/></clipPath>` +
    `<rect width="${w}" height="${h}" fill="${iron.hex}" clip-path="url(#r)"/>` +
    // a 1 px Steel edge inside the pill, so it holds its shape on dark backgrounds
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="2.5" fill="none" stroke="${steel.hex}" stroke-opacity="${BADGE_EDGE}"/>` +
    `<g transform="translate(2 2) scale(${16 / mark.size})">${colourMark}</g>` +
    `<g fill="${paper.hex}">${scaled(text.badge.d, s, lead, baseline)}</g>`
  return svg(w, h, body, "made with efforge", [w, h])
}

// ---- PNG ----------------------------------------------------------------------------------

const paintColourMark = (c: Canvas, t: Transform) =>
  c.fill(mark.punch, blued.hex, t).fill(mark.letters, paper.hex, t, "evenodd")

const avatar = (): Asset => {
  // The colour mark on Paper, 20 px per cell. Sized to survive a circular crop: the punch's
  // square corners are 226 px from the centre, 30 px inside the 256 px circle.
  const size = 512
  const scale = 320 / mark.size
  const at = (size - mark.size * scale) / 2
  const c = new Canvas(size, size, paper.hex)
  paintColourMark(c, { scale, x: at, y: at })
  return { kind: "png", w: size, h: size, rgba: c.bytes() }
}

export const SOCIAL = { w: 1280, h: 640 } as const
const social = (): Asset => {
  const { w, h } = SOCIAL
  const c = new Canvas(w, h, paper.hex)
  const left = 112
  // the lockup, large: the mark is 176 px, 11 px per cell, on whole pixels
  const lt = { scale: 2.75, x: left, y: 92 }
  paintColourMark(c, lt)
  c.fill(wordmark.d, iron.hex, lt)
  // the sentence, in the wordmark's family
  text.sentence.forEach((line, i) => {
    c.fill(line.d, iron.hex, { scale: 0.52, x: left, y: 384 + i * 64 })
  })
  // the command, mono, on an iron slab
  const cs = 0.36
  const padX = 32
  const slab = { x: left, y: 494, w: Math.round(text.command.width * cs + padX * 2), h: 76 }
  c.rect(slab.x, slab.y, slab.w, slab.h, iron.hex)
  c.fill(text.command.d, paper.hex, { scale: cs, x: left + padX, y: slab.y + 49 })
  // a blued-steel foot
  c.rect(0, h - 8, w, 8, blued.hex)
  return { kind: "png", w, h, rgba: c.bytes() }
}

// ---- Code and docs --------------------------------------------------------------------------

const hexRgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

/** Nearest xterm-256 colour (6x6x6 cube and grey ramp) by squared RGB distance. */
const xterm256 = (hex: string): number => {
  const [r, g, b] = hexRgb(hex) as [number, number, number]
  const levels = [0, 95, 135, 175, 215, 255]
  let best = 16
  let bestD = Infinity
  const consider = (i: number, cr: number, cg: number, cb: number) => {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
    if (d < bestD) {
      best = i
      bestD = d
    }
  }
  for (let i = 0; i < 216; i++)
    consider(
      16 + i,
      levels[Math.floor(i / 36)] as number,
      levels[Math.floor(i / 6) % 6] as number,
      levels[i % 6] as number,
    )
  for (let i = 0; i < 24; i++) consider(232 + i, 8 + i * 10, 8 + i * 10, 8 + i * 10)
  return best
}

/**
 * A tempering colour for a diagram node that renders on GitHub's light and dark pages alike: a
 * light tint of it behind Iron text, edged in the colour itself.
 */
const temperNode = (hex: string) => ({
  fill: over(hex, 0.35, paper.hex),
  stroke: hex,
  ink: iron.hex,
})

const cliBrand = () => {
  const nodes = layerColors.map((c) => ({ name: c.name, ...temperNode(c.light) }))
  return `// Generated by scripts/brand/build.ts from scripts/brand/source.ts (\`pnpm brand\`). Do not edit.
/** Colours for the terminal intro: truecolor RGB and the nearest xterm-256 index. */
export const brand = {
  blued: { rgb: [${hexRgb(blued.hex).join(", ")}], ansi256: ${xterm256(blued.hex)} },
  paper: { rgb: [${hexRgb(paper.hex).join(", ")}], ansi256: ${xterm256(paper.hex)} },
} as const

/**
 * The layer colours for diagrams (\`efforge graph\`), one per layer, always in this order, the
 * dashboard's own: a light tint behind Iron text, edged in the colour, so a node reads on light
 * and dark pages.
 */
export const temperNodes = [
${nodes.map((n) => `  { name: "${n.name}", fill: "${n.fill}", stroke: "${n.stroke}", ink: "${n.ink}" },`).join("\n")}
] as const

/** Diagram colours that are not a layer's: the composition (Iron) and what a layer needs (Steel). */
export const diagram = {
  app: { fill: "${iron.hex}", stroke: "${steel.hex}", ink: "${paper.hex}" },
  need: { fill: "${steel.hex}", stroke: "${steel.hex}", ink: "${iron.hex}" },
} as const
`
}

const luminance = (hex: string) => {
  const [r, g, b] = hexRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
/** \`top\` at opacity \`a\` over \`bottom\`, as hex. */
const over = (top: string, a: number, bottom: string) =>
  `#${hexRgb(top)
    .map((v, i) => Math.round(v * a + (hexRgb(bottom)[i] as number) * (1 - a)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`
/** CIE76 distance between two colours (CIE L*a*b*, D65). */
export const deltaE = (one: string, two: string): number => {
  const lab = (hex: string) => {
    const [r, g, b] = hexRgb(hex).map((v) => {
      const c = v / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047)
    const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b)
    const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)] as const
  }
  const [p, q] = [lab(one), lab(two)]
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}
const ratio = (a: string, b: string) => `${(Math.floor(contrast(a, b) * 100) / 100).toFixed(2)}:1`

const paletteTable = () => {
  const rows = Object.values(palette).map((p) => {
    const dark = "dark" in p ? `\`${p.dark}\` (${ratio(p.dark, iron.hex)})` : "same"
    return `| ${p.name} | \`${p.hex}\` | ${ratio(p.hex, paper.hex)} | ${ratio(p.hex, iron.hex)} | ${dark} | ${p.use} |`
  })
  const temperNames = temper.map((k) => palette[k].name).join(", ")
  return [
    "| Name | Hex | On Paper | On Iron | On Iron, use | Use |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    `Pairs the assets use: Paper on Blued steel ${ratio(paper.hex, blued.hex)} (the colour mark's letters, the avatar, the terminal cell); Iron on Paper ${ratio(iron.hex, paper.hex)} (the light lockup, the social preview); Paper on Iron ${ratio(paper.hex, iron.hex)} (the dark lockup, the badge text, the command on the social preview); Blued steel on Iron ${ratio(blued.hex, iron.hex)} (the badge's punch edge, a shape); the badge's edge, Steel at ${BADGE_EDGE * 100}% over Iron, on GitHub dark \`#0d1117\` ${ratio(over(steel.hex, BADGE_EDGE, iron.hex), "#0D1117")} (a shields.io \`#555\` label is ${ratio("#555555", "#0D1117")}); Blued steel on GitHub light \`#ffffff\` ${ratio(blued.hex, "#FFFFFF")} and on GitHub dark \`#0d1117\` ${ratio(blued.hex, "#0D1117")} (the punch's edge; on dark the letters inside, at ${ratio(paper.hex, blued.hex)}, carry the mark).`,
    "",
    `Text needs 4.5:1 (WCAG AA); shapes and large text need 3:1. Where the "On Iron" ratio is below that, the next column gives the value to use on Iron and other dark backgrounds. Straw and Steel are too light for text on Paper: use them as fills behind Iron text (Iron on Straw ${ratio(iron.hex, palette.straw.hex)}). Bronze is ${ratio(palette.bronze.hex, paper.hex)} on Paper, so it is for shapes, not text. The tempering sequence is ${temperNames}, in that order: the first four layer colours below.`,
  ].join("\n")
}

/** The lower of a colour's contrast on a theme's card and background. */
export const onSurfaces = (hex: string, theme: keyof typeof surfaces): number =>
  Math.min(contrast(hex, surfaces[theme].card), contrast(hex, surfaces[theme].background))

/** `a`, `a and b`, `a, b and c`. */
const and = (items: ReadonlyArray<string>): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1) as string}`

/** The named colours whose dashboard value differs from the brand's in either theme. */
const variants = () =>
  and(
    layerColors.flatMap((c) => {
      const p = Object.values(palette).find((x) => x.name === c.name)
      if (p === undefined) return []
      const dark = "dark" in p ? p.dark : p.hex
      return c.light !== p.hex || c.dark !== dark ? [c.name] : []
    }),
  )

const layerTable = () => {
  const floor = (n: number) => (Math.floor(n * 100) / 100).toFixed(2)
  const next = (i: number, theme: "light" | "dark") => {
    const b = layerColors[i + 1]
    return b === undefined
      ? ""
      : Math.round(deltaE(layerColors[i]?.[theme] ?? "", b[theme])).toString()
  }
  const rows = layerColors.map(
    (c, i) =>
      `| ${i + 1} | ${c.name} | \`${c.light}\` | ${floor(onSurfaces(c.light, "light"))}:1 | ${next(i, "light")} | \`${c.dark}\` | ${floor(onSurfaces(c.dark, "dark"))}:1 | ${next(i, "dark")} |`,
  )
  return [
    "| # | Layer colour | Light | On light card and page | Apart from next (ΔE) | Dark | On dark card and page | Apart from next (ΔE) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    `The dashboard's layer graph and cards, and \`efforge graph\`, colour layers in this order. Each value reaches 3:1, what a shape needs, on both surfaces of its theme (card \`${surfaces.light.card}\` and page \`${surfaces.light.background}\` light, \`${surfaces.dark.card}\` and \`${surfaces.dark.background}\` dark), and is at least 20 apart (CIE76 ΔE) from its neighbours. The named colours keep their brand values above for brand use; on the dashboard, ${variants()} use the variants in this table. Every layer is also named in text, so colour is never the only cue.`,
  ].join("\n")
}

const MARK_START = "<!-- generated: palette (pnpm brand) -->"
const MARK_END = "<!-- /generated -->"
const brandDoc = (current: string) => {
  const a = current.indexOf(MARK_START)
  const b = current.indexOf(MARK_END)
  if (a < 0 || b < a) throw new Error(`docs/brand.md needs ${MARK_START} ... ${MARK_END}`)
  return `${current.slice(0, a + MARK_START.length)}\n\n${paletteTable()}\n\n${layerTable()}\n\n${current.slice(b)}`
}

// ---- READMEs --------------------------------------------------------------------------------

const assetUrl = (file: string) => `${repo.raw}/.github/assets/${file}`

const HEADER_START = "<!-- generated: header (pnpm brand) -->"
const header = () =>
  [
    `<h1 align="center">`,
    `  <picture>`,
    `    <source media="(prefers-color-scheme: dark)" srcset="${assetUrl("lockup-dark.svg")}">`,
    `    <img src="${assetUrl("lockup-light.svg")}" width="${LOCKUP.w}" height="${LOCKUP.h}" alt="efforge logo: ${copy.mark}, beside the word efforge">`,
    `  </picture>`,
    `</h1>`,
  ].join("\n")
const readmeHeader = (current: string) => {
  const a = current.indexOf(HEADER_START)
  const b = current.indexOf(MARK_END, a)
  if (a < 0 || b < a) throw new Error(`README.md needs ${HEADER_START} ... ${MARK_END}`)
  return `${current.slice(0, a + HEADER_START.length)}\n${header()}\n${current.slice(b)}`
}

const BADGE_LINE = "[![Made with efforge]("
/** The generated app's README: the badge line, found by its alt text (no marker in users' files). */
const badgeLine = (current: string) => {
  const lines = current.split("\n")
  const i = lines.findIndex((l) => l.startsWith(BADGE_LINE))
  if (i < 0) throw new Error(`templates/base/files/README.md needs a line starting ${BADGE_LINE}`)
  lines[i] = `${BADGE_LINE}${assetUrl("made-with-efforge.svg")})](${repo.url})`
  return lines.join("\n")
}

/** The generated app's styles.css with its `--temper-N` tokens set to the layer colours, per theme. */
const stylesTokens = (current: string) => {
  let theme = 0
  return current.replace(/(\n {2}--temper-1: [^\n]*(?:\n {2}--temper-\d+: [^\n]*)*)/g, () => {
    const key = theme++ === 0 ? "light" : "dark"
    return layerColors.map((c, i) => `\n  --temper-${i + 1}: ${c[key].toLowerCase()};`).join("")
  })
}

// ---- All of it ------------------------------------------------------------------------------

const favicon = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${mark.size} ${mark.size}"><!-- efforge's mark, a placeholder: replace this file with your app's icon. -->${colourMark}</svg>\n`

/** Path -> asset. `read` returns a committed file's text (for docs with generated sections). */
export const assets = (read: (path: string) => string): Map<string, Asset> => {
  const t = (body: string): Asset => ({ kind: "text", body })
  const M = mark.size
  return new Map<string, Asset>([
    [".github/assets/logo.svg", t(svg(M, M, colourMark, "efforge", [M, M]))],
    [".github/assets/mark-light.svg", t(svg(M, M, monoMark(iron.hex), "efforge"))],
    [".github/assets/mark-dark.svg", t(svg(M, M, monoMark(paper.hex), "efforge"))],
    [".github/assets/ligature-light.svg", t(ligatureSvg(iron.hex))],
    [".github/assets/ligature-dark.svg", t(ligatureSvg(paper.hex))],
    [".github/assets/lockup-light.svg", t(lockupSvg(iron.hex))],
    [".github/assets/lockup-dark.svg", t(lockupSvg(paper.hex))],
    [".github/assets/made-with-efforge.svg", t(badgeSvg())],
    [".github/assets/avatar.png", avatar()],
    [".github/assets/social-preview.png", social()],
    ["templates/base/files/web/public/favicon.svg", t(favicon())],
    ["src/brand.ts", t(cliBrand())],
    [
      "templates/base/files/web/src/styles.css",
      t(stylesTokens(read("templates/base/files/web/src/styles.css"))),
    ],
    ["docs/brand.md", t(brandDoc(read("docs/brand.md")))],
    ["README.md", t(readmeHeader(read("README.md")))],
    ["templates/base/files/README.md", t(badgeLine(read("templates/base/files/README.md")))],
  ])
}

export const encode = (a: Asset): Uint8Array =>
  a.kind === "text" ? Buffer.from(a.body) : encodePng(a.w, a.h, a.rgba)
