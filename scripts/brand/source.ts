// The single source of efforge's identity. Every brand asset in the repo is generated from this
// file by `pnpm brand` (scripts/brand/build.ts). To change the mark: edit it here, run
// `pnpm brand`, commit. test/brand.test.ts fails when a generated asset is stale.

/**
 * The mark: a maker's punch with `ef` struck through it; the e and the f are one bar.
 * A 64 x 64 box on a 16 x 16 grid of 4-unit cells, so at 16 px each cell is one pixel.
 * `punch` is the square with its top-left and bottom-right corners cut at 45 degrees;
 * `letters` is the `ef` ligature (an even-odd path: the e's eye is a hole).
 */
export const mark = {
  /** The mark's box (size x size units); the lockup and every asset scale from it. */
  size: 64,
  cell: 4,
  punch: "M20 0H64V48L48 64H0V20Z",
  letters:
    "M12 56H28L36 48H16V44H40V56H48V44H56V36H48V16L56 8H44A4 4 0 0 0 40 12V36H32V24A4 4 0 0 0 28 20H12A4 4 0 0 0 8 24V52A4 4 0 0 0 12 56ZM16 28H24V36H16Z",
} as const

/**
 * Named colours. `dark` is the value to use on Iron (or any dark background) where the base
 * value fails contrast there; contrast ratios are computed and checked in docs/brand.md.
 */
export const palette = {
  iron: { name: "Iron", hex: "#1C1D20", use: "Ink on light; dark background" },
  paper: { name: "Paper", hex: "#F6F5F1", use: "Light background; ink on dark" },
  blued: {
    name: "Blued steel",
    hex: "#2F5AA8",
    dark: "#7DA2E3",
    use: "The brand colour: the punch in colour, links, the primary action",
  },
  steel: { name: "Steel", hex: "#C9CDD2", use: "Borders, muted fills" },
  straw: { name: "Straw", hex: "#E2C275", use: "Highlight; first tempering colour" },
  bronze: { name: "Bronze", hex: "#A8683A", use: "Second tempering colour (diagrams only)" },
  purple: {
    name: "Temper purple",
    hex: "#6C4E96",
    dark: "#AD8FDB",
    use: "Third tempering colour (diagrams only)",
  },
  red: {
    name: "Assay red",
    hex: "#C8372D",
    dark: "#E8786E",
    use: "Refusals and conflicts only, never decoration",
  },
} as const

/** The tempering sequence: the four named colours steel passes through, in this order. */
export const temper = ["straw", "bronze", "purple", "blued"] as const

/** The surfaces the dashboard draws layer colours on, per theme (styles.css `--card`, `--background`). */
export const surfaces = {
  light: { card: "#FCFBF8", background: "#F6F5F1" },
  dark: { card: "#222327", background: "#1C1D20" },
} as const

/**
 * The layer colours, one per layer of `AppLayer`, always in this order: the tempering sequence,
 * then seven more, so a project with every add-on (eleven layers) repeats none. The dashboard's layer
 * graph and cards use `light` and `dark` (each at least 3:1 on both surfaces of its theme, and
 * apart from its neighbours: checked in docs/brand.md and test/brand.test.ts); `efforge graph`
 * draws its Mermaid nodes from `light`. A named colour keeps its brand value in `palette`; these
 * are its dashboard variants. No orange.
 */
export const layerColors = [
  { name: "Straw", light: "#9A8C33", dark: "#E2C275" },
  { name: "Bronze", light: "#A8683A", dark: "#C98A58" },
  { name: "Temper purple", light: "#774990", dark: "#BC8BD5" },
  { name: "Blued steel", light: "#2F5AA8", dark: "#7DA2E3" },
  { name: "Sky", light: "#3496B4", dark: "#A9C9E6" },
  { name: "Gold", light: "#B38323", dark: "#BF8D2E" },
  { name: "Plum", light: "#8A4F6E", dark: "#C58AA8" },
  { name: "Slate", light: "#6B7078", dark: "#A3A7AE" },
  { name: "Teal", light: "#3D7F73", dark: "#7FBFB2" },
  { name: "Indigo", light: "#5045B8", dark: "#8574E6" },
  { name: "Moss", light: "#5E7A2A", dark: "#A9C774" },
] as const

/**
 * The wordmark `efforge`, outlined, in lockup coordinates: the mark sits at 0..64 and the
 * word's x-height (20..56) equals the height of the mark's e. Vendored so `pnpm brand`
 * needs neither the font nor the network; scripts/brand/outline.ts re-derives it.
 */
export const wordmark = {
  font: {
    family: "Saira Semi Condensed",
    weight: 600,
    package: "@fontsource/saira-semi-condensed",
    version: "5.3.0",
    licence: "SIL Open Font License 1.1",
  },
  d: "M115.48 38.07L115.48 40.75L95.79 40.75Q95.79 44.99 96.25 46.65Q96.71 48.31 98.44 48.91Q100.16 49.51 104.47 49.51Q109.06 49.51 114.35 48.94L114.35 55.51Q112.31 56 108.99 56.28Q105.67 56.56 102.56 56.56Q95.58 56.56 92.36 54.76Q89.15 52.96 88.20 49.26Q87.25 45.55 87.25 38.07Q87.25 30.80 88.20 27.02Q89.15 23.25 92.26 21.34Q95.36 19.44 101.93 19.44Q108.35 19.44 111.21 21.27Q114.07 23.11 114.78 26.74Q115.48 30.38 115.48 38.07M101.79 26.42Q99.04 26.42 97.84 27.06Q96.64 27.69 96.25 29.39Q95.86 31.08 95.79 34.96L107.44 34.96Q107.44 31.08 106.98 29.32Q106.52 27.55 105.35 26.99Q104.19 26.42 101.79 26.42M126.60 56L126.60 27.13L120.81 27.13L120.81 20L126.60 20L126.60 16.75Q126.60 10.47 127.94 7.79Q129.28 5.11 132.39 4.36Q135.49 3.62 142.69 3.62L142.69 9.98Q139.16 9.98 137.68 10.29Q136.20 10.61 135.67 11.64Q135.14 12.66 135.14 15.13L135.14 20L142.69 20L142.69 27.13L135.14 27.13L135.14 56M152.05 56L152.05 27.13L146.26 27.13L146.26 20L152.05 20L152.05 16.75Q152.05 10.47 153.39 7.79Q154.73 5.11 157.84 4.36Q160.94 3.62 168.14 3.62L168.14 9.98Q164.61 9.98 163.13 10.29Q161.65 10.61 161.12 11.64Q160.59 12.66 160.59 15.13L160.59 20L168.14 20L168.14 27.13L160.59 27.13L160.59 56M187.87 56.56Q180.95 56.56 177.92 54.98Q174.88 53.39 174.04 49.75Q173.19 46.12 173.19 38Q173.19 29.81 174.04 26.18Q174.88 22.54 177.92 20.99Q180.95 19.44 187.87 19.44Q194.72 19.44 197.75 20.99Q200.79 22.54 201.64 26.21Q202.48 29.88 202.48 38Q202.48 46.12 201.64 49.75Q200.79 53.39 197.75 54.98Q194.72 56.56 187.87 56.56M187.87 49.44Q190.98 49.44 192.18 48.73Q193.38 48.02 193.66 45.91Q193.94 43.79 193.94 38Q193.94 32.14 193.66 30.06Q193.38 27.98 192.21 27.27Q191.05 26.56 187.87 26.56Q184.69 26.56 183.49 27.27Q182.29 27.98 182.01 30.06Q181.73 32.14 181.73 38Q181.73 43.79 182.01 45.91Q182.29 48.02 183.49 48.73Q184.69 49.44 187.87 49.44M210.71 56L210.71 20L218.61 20L218.89 26.21L219.46 26.21Q220.59 22.40 223.02 20.92Q225.46 19.44 229.55 19.44L229.55 27.98Q225.53 27.98 223.31 29.18Q221.08 30.38 220.13 33.06Q219.18 35.74 219.18 40.47L219.18 56M247.94 70.33Q245.05 70.33 241.91 70.12Q238.76 69.91 236.86 69.55L236.86 62.99Q241.80 63.20 245.96 63.20Q250.27 63.20 252.04 62.53Q253.80 61.86 254.33 59.99Q254.86 58.12 254.86 53.60L254.86 51.55L254.36 51.55Q253.24 54.02 250.98 55.05Q248.72 56.07 245.40 56.07Q241.16 56.07 238.84 54.45Q236.51 52.82 235.48 48.94Q234.46 45.06 234.46 37.93Q234.46 30.66 235.52 26.71Q236.58 22.75 238.94 21.09Q241.31 19.44 245.47 19.44Q252.46 19.44 254.65 24.52L255.14 24.52L255.42 20L263.33 20L263.33 51.62Q263.33 59.04 262.38 62.78Q261.42 66.52 258.18 68.42Q254.93 70.33 247.94 70.33M249 48.66Q251.12 48.66 252.28 48.06Q253.45 47.46 254.01 45.98Q254.51 44.78 254.68 42.87Q254.86 40.96 254.86 37.86Q254.86 32.07 254.08 30.09Q253.52 28.40 252.35 27.73Q251.19 27.06 249 27.06Q246.11 27.06 244.94 27.69Q243.78 28.33 243.39 30.45Q243 32.56 243 37.86Q243 43.08 243.39 45.20Q243.78 47.32 244.94 47.99Q246.11 48.66 249 48.66M299.79 38.07L299.79 40.75L280.09 40.75Q280.09 44.99 280.55 46.65Q281.01 48.31 282.74 48.91Q284.47 49.51 288.78 49.51Q293.36 49.51 298.66 48.94L298.66 55.51Q296.61 56 293.29 56.28Q289.98 56.56 286.87 56.56Q279.88 56.56 276.67 54.76Q273.46 52.96 272.51 49.26Q271.55 45.55 271.55 38.07Q271.55 30.80 272.51 27.02Q273.46 23.25 276.56 21.34Q279.67 19.44 286.24 19.44Q292.66 19.44 295.52 21.27Q298.38 23.11 299.08 26.74Q299.79 30.38 299.79 38.07M286.09 26.42Q283.34 26.42 282.14 27.06Q280.94 27.69 280.55 29.39Q280.16 31.08 280.09 34.96L291.74 34.96Q291.74 31.08 291.28 29.32Q290.82 27.55 289.66 26.99Q288.49 26.42 286.09 26.42",
} as const

/** Words set in the generated assets. Changing them needs `pnpm brand:outline` (fonts). */
export const copy = {
  /** The social preview's sentence, one entry per line. */
  sentence: ["The maintained way to start a full-stack", "Effect app on Cloudflare."],
  command: "npm create efforge",
  badge: "made with efforge",
  /** What the mark shows, for alt text. */
  mark: "a maker's punch with ef struck through it",
} as const

/**
 * Where the repo is served from. `pnpm brand` builds the asset URLs in README.md's header and
 * the generated app's badge line (templates/base/files/README.md) from it.
 */
export const repo = {
  url: "https://github.com/amagdy46/efforge",
  raw: "https://raw.githubusercontent.com/amagdy46/efforge/main",
} as const
