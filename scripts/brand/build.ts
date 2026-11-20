// `pnpm brand`: regenerates every brand asset from scripts/brand/source.ts.
// A PNG is rewritten only when its pixels change, so the committed bytes stay stable
// across zlib versions; text files are rewritten when they differ.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { decodePng } from "./raster.ts"
import { assets, encode } from "./assets.ts"

const root = fileURLToPath(new URL("../..", import.meta.url))
const read = (p: string) => readFileSync(join(root, p), "utf8")

let changed = 0
for (const [path, asset] of assets(read)) {
  const file = join(root, path)
  if (existsSync(file)) {
    const old = readFileSync(file)
    const same =
      asset.kind === "text"
        ? old.toString("utf8") === asset.body
        : (() => {
            try {
              const d = decodePng(old)
              return d.w === asset.w && d.h === asset.h && Buffer.from(d.rgba).equals(asset.rgba)
            } catch {
              return false
            }
          })()
    if (same) continue
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, encode(asset))
  console.log(`wrote ${path}`)
  changed++
}
console.log(changed === 0 ? "brand assets are up to date" : `${changed} file(s) written`)
