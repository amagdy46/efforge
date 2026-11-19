import { Effect } from "effect"
import { syncSections } from "../regions.ts"
import { missing, req, type Transform, withFile } from "./util.ts"

export const AGENTS_FILE = "AGENTS.md"
const FILE = AGENTS_FILE

/**
 * args: `{ id, content }` — writes `content` (markdown, usually a `##` section) between
 * `<!-- efforge:section:id -->` and `<!-- /efforge:section:id -->` in the root AGENTS.md: a new
 * section goes before the `<!-- efforge:agents -->` footer, an existing one gets this content. An
 * AGENTS.md whose markers are broken is left alone (`add` says so). `syncAgents` then puts every
 * section of the stack in order.
 */
export const appendAgentsSection: Transform = (tree, args) =>
  Effect.gen(function* () {
    const id = req(args, "id", "appendAgentsSection")
    const content = req(args, "content", "appendAgentsSection").trim()
    const text = tree.get(FILE)
    if (text === undefined)
      return yield* missing(FILE, "file", `Create ${FILE} and add the section:\n${content}`)
    const synced = syncSections(text, "efforge:section", [{ id, content }], {
      footer: "<!-- efforge:agents -->",
      owned: () => false,
    })
    if (synced.kind !== "synced" || synced.text === text) return tree
    return withFile(tree, FILE, synced.text)
  })
