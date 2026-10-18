import { Effect } from "effect"
import { isMap, isNode, isScalar, parseDocument } from "yaml"
import { missing, req, type Transform, withFile } from "./util.ts"

export const WORKFLOW_FILE = ".github/workflows/deploy.yml"

/**
 * args: `{ name }` — exposes the repository secret `name` to the deploy workflow by adding
 * `NAME: ${{ secrets.NAME }}` to its top-level `env:` map, before `CI` (or last when there is no
 * `CI`). The text is edited in place, so comments and folded expressions survive; a name that is
 * already listed leaves the file untouched.
 */
export const addWorkflowSecret: Transform = (tree, args) =>
  Effect.gen(function* () {
    const name = req(args, "name", "addWorkflowSecret")
    const line = `${name}: \${{ secrets.${name} }}`
    const snippet = `In ${WORKFLOW_FILE}, add under the top-level \`env:\`:\n  ${line}`
    const text = tree.get(WORKFLOW_FILE)
    if (text === undefined) return yield* missing(WORKFLOW_FILE, "file", snippet)

    const env = parseDocument(text).get("env", true)
    if (!isMap(env) || env.items.length === 0) return yield* missing(WORKFLOW_FILE, "env:", snippet)
    if (env.has(name)) return tree

    const eol = text.includes("\r\n") ? "\r\n" : "\n"
    const ci = env.items.find((pair) => isScalar(pair.key) && pair.key.value === "CI")
    const first = env.items[0]?.key
    const ciAt = isNode(ci?.key) ? ci.key.range?.[0] : undefined
    const indentAt = isNode(first) ? first.range?.[0] : undefined
    if (indentAt === undefined) return yield* missing(WORKFLOW_FILE, "env:", snippet)
    const indent = text.slice(text.lastIndexOf("\n", indentAt - 1) + 1, indentAt)

    if (ciAt !== undefined) {
      const lineStart = text.lastIndexOf("\n", ciAt - 1) + 1
      return withFile(
        tree,
        WORKFLOW_FILE,
        `${text.slice(0, lineStart)}${indent}${line}${eol}${text.slice(lineStart)}`,
      )
    }
    const lastValue = env.items.at(-1)?.value
    const valueEnd = isNode(lastValue) ? lastValue.range?.[1] : undefined
    if (valueEnd === undefined) return yield* missing(WORKFLOW_FILE, "env:", snippet)
    const lineEnd = text.indexOf("\n", valueEnd)
    const at = lineEnd === -1 ? text.length : lineEnd + 1
    const lead = lineEnd === -1 ? eol : ""
    return withFile(
      tree,
      WORKFLOW_FILE,
      `${text.slice(0, at)}${lead}${indent}${line}${eol}${text.slice(at)}`,
    )
  })
