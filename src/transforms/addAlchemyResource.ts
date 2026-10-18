import { Effect } from "effect"
import { Node, SyntaxKind } from "ts-morph"
import { appendListItem, missing, parseTs, req, type Transform, withFile } from "./util.ts"

export const ALCHEMY_FILE = "infra/alchemy.run.ts"
const MARKER = "// efforge:resources"

/**
 * args: `{ name, code }` — inserts `code` before the `// efforge:resources` marker and adds the
 * shorthand `name` to the object passed as `bindings:`. Skips each half that is already present.
 */
export const addAlchemyResource: Transform = (tree, args) =>
  Effect.gen(function* () {
    const name = req(args, "name", "addAlchemyResource")
    const code = req(args, "code", "addAlchemyResource")
    const snippet = `In ${ALCHEMY_FILE}:\n  ${code}\n  ...and add \`${name}\` to the \`bindings: { ... }\` object of your Worker/Website.`
    const text = tree.get(ALCHEMY_FILE)
    if (text === undefined) return yield* missing(ALCHEMY_FILE, "file", snippet)

    const sf = parseTs(ALCHEMY_FILE, text)
    const declared = sf
      .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
      .some((d) => d.getName() === name)
    const markerAt = text.indexOf(MARKER)
    if (!declared && markerAt < 0) return yield* missing(ALCHEMY_FILE, MARKER, snippet)

    const bindings = sf
      .getDescendantsOfKind(SyntaxKind.PropertyAssignment)
      .find((p) => p.getName() === "bindings" && Node.isObjectLiteralExpression(p.getInitializer()))
      ?.getInitializer()
    if (!Node.isObjectLiteralExpression(bindings))
      return yield* missing(ALCHEMY_FILE, "bindings: { ... }", snippet)

    let next = text
    // bindings sits after the marker in most files, so edit the later position first
    const hasBinding = bindings.getProperty(name) !== undefined
    const edits: Array<{ at: number; apply: (t: string) => string }> = []
    if (!hasBinding) {
      edits.push({
        at: bindings.getStart(),
        apply: (t) => {
          const o = parseTs(ALCHEMY_FILE, t)
            .getDescendantsOfKind(SyntaxKind.PropertyAssignment)
            .find(
              (p) =>
                p.getName() === "bindings" && Node.isObjectLiteralExpression(p.getInitializer()),
            )
            ?.getInitializer()
          if (!Node.isObjectLiteralExpression(o)) return t
          return appendListItem(
            t,
            o.getStart(),
            o.getEnd() - 1,
            o.getProperties().at(-1)?.getEnd(),
            name,
          )
        },
      })
    }
    if (!declared) {
      edits.push({
        at: markerAt,
        apply: (t) => {
          const m = t.indexOf(MARKER)
          const lineStart = t.lastIndexOf("\n", m) + 1
          const indent = /^[ \t]*/.exec(t.slice(lineStart))?.[0] ?? ""
          const block = code
            .split("\n")
            .map((l) => (l === "" ? l : indent + l))
            .join("\n")
          const eol = t.includes("\r\n") ? "\r\n" : "\n"
          return `${t.slice(0, lineStart)}${block.replace(/\n/g, eol)}${eol}${t.slice(lineStart)}`
        },
      })
    }
    for (const e of edits.sort((a, b) => b.at - a.at)) next = e.apply(next)
    return withFile(tree, ALCHEMY_FILE, next)
  })
