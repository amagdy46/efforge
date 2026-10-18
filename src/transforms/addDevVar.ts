import { Effect } from "effect"
import { req, type Transform, withFile } from "./util.ts"

const FILE = ".dev.vars"
const HEADER = `# Local development secrets, read by \`pnpm dev\` (gitignored). In production set the same names as
# Worker secrets/vars, e.g. \`wrangler secret put NAME\`.
`

/**
 * args: `{ name, value }` — appends `NAME=value` to `.dev.vars` (created with a header when no
 * add-on made it yet). A name that is already set is left alone, so repeated runs are identical.
 */
export const addDevVar: Transform = (tree, args) =>
  Effect.sync(() => {
    const name = req(args, "name", "addDevVar")
    const value = req(args, "value", "addDevVar")
    const text = tree.get(FILE) ?? HEADER
    if (new RegExp(`^${name}=`, "m").test(text)) return tree
    return withFile(tree, FILE, `${text}${text.endsWith("\n") ? "" : "\n"}${name}=${value}\n`)
  })
