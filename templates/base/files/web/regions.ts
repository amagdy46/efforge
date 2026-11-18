import { readFile } from "node:fs/promises"
import type { Plugin } from "vite"

const START = /^\s*\/\/ #region (\S+)\s*$/
const END = /^\s*\/\/ #endregion\b/
const QUERY = /\?region=([\w-]+)$/

/**
 * The lines between `// #region <name>` and the next `// #endregion` in `source`, without their
 * common indent, or undefined when the file has no such region.
 */
export const region = (source: string, name: string): string | undefined => {
  const lines = source.split("\n")
  const start = lines.findIndex((line) => START.exec(line)?.[1] === name)
  if (start === -1) return undefined
  const body = lines.slice(start + 1)
  const end = body.findIndex((line) => END.test(line))
  if (end === -1) return undefined
  const picked = body.slice(0, end).filter((line) => !START.test(line))
  const indent = Math.min(
    ...picked
      .filter((line) => line.trim() !== "")
      .map((line) => /^\s*/.exec(line)?.[0].length ?? 0),
  )
  return picked
    .map((line) => line.slice(Number.isFinite(indent) ? indent : 0))
    .join("\n")
    .trim()
}

/**
 * `import source from "./file.ts?region=card"` is the `card` region of that file as a string, and
 * nothing else: the rest of the file never reaches the browser. A file without the region fails the
 * build. Capability cards show their code this way (docs/capability-cards.md in the efforge repo);
 * `pnpm dev` reloads the card when the file changes.
 */
export const regions = (): Plugin => ({
  name: "efforge:regions",
  enforce: "pre",
  async load(id) {
    const query = QUERY.exec(id)
    if (query === null) return null
    const file = id.slice(0, query.index)
    const name = query[1] ?? "card"
    this.addWatchFile(file)
    const text = region(await readFile(file, "utf8"), name)
    if (text === undefined)
      this.error(
        `${file} has no "// #region ${name}" ... "// #endregion" block. A card shows only a marked region of a file, so mark the part to show.`,
      )
    return `export default ${JSON.stringify(text)}\n`
  },
})
