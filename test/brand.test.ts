import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, it } from "vitest"
import { assets } from "../scripts/brand/assets.ts"
import { decodePng } from "../scripts/brand/raster.ts"
import { copy, mark, repo } from "../scripts/brand/source.ts"
import { text } from "../scripts/brand/text.ts"
import { colorLevel, introLine } from "../src/intro.ts"

const root = new URL("..", import.meta.url).pathname
const read = (p: string) => readFileSync(join(root, p), "utf8")

it("every generated brand asset matches scripts/brand/source.ts (run pnpm brand)", () => {
  const stale: string[] = []
  for (const [path, asset] of assets(read)) {
    const file = join(root, path)
    if (!existsSync(file)) {
      stale.push(`${path} (missing)`)
      continue
    }
    if (asset.kind === "text") {
      if (readFileSync(file, "utf8") !== asset.body) stale.push(path)
      continue
    }
    // PNGs are compared by pixels: zlib versions may compress the same pixels differently
    const png = decodePng(readFileSync(file))
    if (png.w !== asset.w || png.h !== asset.h || !Buffer.from(png.rgba).equals(asset.rgba))
      stale.push(path)
  }
  expect(stale, "stale brand assets; run pnpm brand").toEqual([])
}, 60_000)

it("the outlined text matches the copy in source.ts (run pnpm brand:outline)", () => {
  expect(text.sentence.map((l) => l.text)).toEqual(copy.sentence)
  expect(text.command.text).toBe(copy.command)
  expect(text.badge.text).toBe(copy.badge)
})

it("every brand URL in the READMEs names a committed file", () => {
  const prefix = `${repo.raw}/`
  for (const readme of ["README.md", "templates/base/files/README.md"]) {
    const urls = read(readme).match(/https:\/\/raw\.githubusercontent\.com\/[^\s")]+/g) ?? []
    expect(urls.length, readme).toBeGreaterThan(0)
    for (const url of urls) {
      expect(url.startsWith(prefix), url).toBe(true)
      expect(existsSync(join(root, url.slice(prefix.length))), url).toBe(true)
    }
  }
})

it("the mark sits on its 4-unit grid", () => {
  const numbers = `${mark.punch} ${mark.letters}`.match(/-?\d+(?:\.\d+)?/g) ?? []
  expect(numbers.length).toBeGreaterThan(0)
  for (const n of numbers) expect(Number(n) % mark.cell, n).toBe(0)
})

it("the intro is plain without a colour terminal and coloured with one", () => {
  const tty = { TERM: "xterm-256color" }
  expect(colorLevel(tty, false)).toBe("none")
  expect(colorLevel({ ...tty, NO_COLOR: "1" }, true)).toBe("none")
  expect(colorLevel({ ...tty, CI: "true" }, true)).toBe("none")
  expect(colorLevel({ TERM: "dumb" }, true)).toBe("none")
  expect(colorLevel(tty, true)).toBe("256")
  expect(colorLevel({ ...tty, COLORTERM: "truecolor" }, true)).toBe("truecolor")
  expect(colorLevel({ FORCE_COLOR: "3" }, false)).toBe("truecolor")

  expect(introLine("", "none", "1.2.3")).toBe("efforge 1.2.3")
  expect(introLine("add email", "none", "1.2.3")).toBe("efforge 1.2.3  add email")
  expect(introLine("", "truecolor", "1.2.3")).toBe(
    "\x1b[1;38;2;246;245;241;48;2;47;90;168m ef \x1b[0m efforge 1.2.3",
  )
  expect(introLine("", "256", "1.2.3")).toBe("\x1b[1;38;5;255;48;5;25m ef \x1b[0m efforge 1.2.3")
})
