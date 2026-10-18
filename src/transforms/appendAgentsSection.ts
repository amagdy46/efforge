import { Effect } from "effect"
import { missing, req, type Transform, withFile } from "./util.ts"

const FILE = "AGENTS.md"
const END = "<!-- efforge:agents -->"

/**
 * args: `{ id, content }` — inserts `content` (markdown, usually a `##` section) before the
 * `<!-- efforge:agents -->` footer of the root AGENTS.md, behind an `<!-- efforge:section:id -->`
 * marker. A section whose marker is already present is left alone, so repeated runs are identical.
 */
export const appendAgentsSection: Transform = (tree, args) =>
  Effect.gen(function* () {
    const id = req(args, "id", "appendAgentsSection")
    const content = req(args, "content", "appendAgentsSection").trim()
    const text = tree.get(FILE)
    if (text === undefined)
      return yield* missing(FILE, "file", `Create ${FILE} and add the section:\n${content}`)

    const marker = `<!-- efforge:section:${id} -->`
    if (text.includes(marker)) return tree
    const section = `${marker}\n${content}\n\n`
    const at = text.lastIndexOf(END)
    return withFile(
      tree,
      FILE,
      at === -1
        ? `${text}${text.endsWith("\n") ? "" : "\n"}\n${section.trimEnd()}\n`
        : `${text.slice(0, at)}${section}${text.slice(at)}`,
    )
  })
