import { brand } from "./brand.ts"
import { efforgeVersion } from "./versions.ts"

export type ColorLevel = "none" | "256" | "truecolor"

/**
 * How much colour the intro may use. Plain under NO_COLOR, TERM=dumb, in CI and when stdout is
 * not a terminal; FORCE_COLOR overrides the terminal check (FORCE_COLOR=3 asks for truecolor).
 */
export const colorLevel = (
  env: Record<string, string | undefined> = process.env,
  isTTY: boolean = process.stdout.isTTY,
): ColorLevel => {
  const force = env.FORCE_COLOR
  if (force === "0" || force === "false") return "none"
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return "none"
  if (force === undefined || force === "") {
    if (!isTTY || env.TERM === "dumb" || (env.CI !== undefined && env.CI !== "false")) return "none"
  }
  const truecolor = env.COLORTERM === "truecolor" || env.COLORTERM === "24bit" || force === "3"
  return truecolor ? "truecolor" : "256"
}

/** The one-line intro: a blued-steel ` ef ` cell, then `efforge <version>` and a dim `detail`. */
export const introLine = (
  detail = "",
  level: ColorLevel = colorLevel(),
  version = efforgeVersion,
): string => {
  const name = `efforge ${version}`
  if (level === "none") return detail === "" ? name : `${name}  ${detail}`
  const [br, bg, bb] = brand.blued.rgb
  const [pr, pg, pb] = brand.paper.rgb
  const cell =
    level === "truecolor"
      ? `\x1b[1;38;2;${pr};${pg};${pb};48;2;${br};${bg};${bb}m`
      : `\x1b[1;38;5;${brand.paper.ansi256};48;5;${brand.blued.ansi256}m`
  return `${cell} ef \x1b[0m ${name}${detail === "" ? "" : `  \x1b[2m${detail}\x1b[22m`}`
}
