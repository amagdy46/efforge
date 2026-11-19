import { stripVTControlCharacters } from "node:util"

// Word wrapping for everything efforge prints to people: prompts, ordinary output and errors on
// stderr. A line breaks only between words of prose: never inside a path (a path is one word) and
// never inside a command, so a command can be copied from the terminal as it reads.

/** A command, alone on its line: never broken, so it can be copied. */
export const isCommandLine = (line: string): boolean =>
  /^\s*(?:npx|pnpm|cd|docker|git) /.test(stripVTControlCharacters(line))

const starts = new Set(["npx", "pnpm", "npm", "cd", "git", "docker", "wrangler"])
/** Words that end a command inside a sentence ("run cd app && git init to give it ..."). */
const prose = new Set(
  "to then and or which so before after when if for first again instead yourself there here in with from it its that this is are was".split(
    " ",
  ),
)

/**
 * The words of `line`, with each command inside it (from `npx`, `pnpm`, `cd`, `git` ... to the
 * end of its sentence or the next word of prose) joined into one unbreakable piece.
 */
const pieces = (line: string): string[] => {
  const words = line.split(" ")
  const out: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string
    if (!starts.has(stripVTControlCharacters(w)) || i === words.length - 1) {
      out.push(w)
      continue
    }
    let piece = w
    while (i + 1 < words.length) {
      const last = stripVTControlCharacters(piece.slice(piece.lastIndexOf(" ") + 1))
      if (last.length > 1 && /[.,;:)]$/.test(last) && piece !== w) break
      const next = stripVTControlCharacters(words[i + 1] as string)
      if (prose.has(next) || /^[A-Z(]/.test(next)) break
      piece = `${piece} ${words[++i]}`
    }
    out.push(piece)
  }
  return out
}

/**
 * Word-wraps prose to `width` columns, measured without colours. An indented line and a command
 * line are kept whole, and a command inside a sentence moves to the next line whole: one that
 * doesn't fit is still one piece, so it can be copied.
 */
export const wrapProse = (text: string, width: number): string =>
  text
    .split("\n")
    .flatMap((line) => {
      if (/^\s/.test(line) || isCommandLine(line)) return [line]
      const out: string[] = []
      let current = ""
      for (const word of pieces(line)) {
        const next = current === "" ? word : `${current} ${word}`
        if (current !== "" && stripVTControlCharacters(next).length > width) {
          out.push(current)
          current = word
        } else current = next
      }
      out.push(current)
      return out
    })
    .join("\n")
