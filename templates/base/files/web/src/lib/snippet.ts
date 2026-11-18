const START = /^\s*\/\/ #region (\S+)\s*$/
const END = /^\s*\/\/ #endregion\b/

/**
 * The lines between `// #region <name>` and `// #endregion` in `source`, without their common
 * indent. Cards import a file with `?raw` and show this part of it, so an edit to the file shows on
 * the card. Without the markers it is the whole file.
 */
export const region = (source: string, name: string): string => {
  const lines = source.split("\n")
  const start = lines.findIndex((line) => START.exec(line)?.[1] === name)
  const body = start === -1 ? lines : lines.slice(start + 1)
  const end = body.findIndex((line) => END.test(line))
  const picked = (end === -1 || start === -1 ? body : body.slice(0, end)).filter(
    (line) => !START.test(line) && !END.test(line),
  )
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
