import { Effect } from "effect"
import { Node, SyntaxKind } from "ts-morph"
import { appendListItem, missing, parseTs, req, type Transform, withFile } from "./util.ts"

export const ALCHEMY_FILE = "infra/alchemy.run.ts"
const MARKER = "// efforge:resources"

/** The Worker props that hold bindings: Alchemy v2 calls it `env`; `bindings` is accepted too. */
const BINDING_PROPS = ["env", "bindings"]

/**
 * args: `{ name, code, binding? }` — inserts `code` before the `// efforge:resources` marker and
 * adds `name` to the object passed as `env:` (or `bindings:`) of the Worker/Website: as the
 * shorthand `name`, or as `binding: name` when the binding key (e.g. `HYPERDRIVE`) differs from the
 * variable. Skips each half that is already present.
 */
export const addAlchemyResource: Transform = (tree, args) =>
  Effect.gen(function* () {
    const name = req(args, "name", "addAlchemyResource")
    const code = req(args, "code", "addAlchemyResource")
    const binding = typeof args.binding === "string" ? args.binding : name
    const entry = binding === name ? name : `${binding}: ${name}`
    const snippet = `In ${ALCHEMY_FILE}:\n  ${code}\n  ...and add \`${entry}\` to the \`env: { ... }\` object of your Worker/Website.`
    const text = tree.get(ALCHEMY_FILE)
    if (text === undefined) return yield* missing(ALCHEMY_FILE, "file", snippet)

    const sf = parseTs(ALCHEMY_FILE, text)
    const declared = sf
      .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
      .some((d) => d.getName() === name)
    const markerAt = text.indexOf(MARKER)
    if (!declared && markerAt < 0) return yield* missing(ALCHEMY_FILE, MARKER, snippet)

    const findBindings = (file: typeof sf) =>
      file
        .getDescendantsOfKind(SyntaxKind.PropertyAssignment)
        .find(
          (p) =>
            BINDING_PROPS.includes(p.getName()) &&
            Node.isObjectLiteralExpression(p.getInitializer()),
        )
        ?.getInitializer()
    const bindings = findBindings(sf)
    if (!Node.isObjectLiteralExpression(bindings))
      return yield* missing(ALCHEMY_FILE, "env: { ... }", snippet)

    let next = text
    // bindings sits after the marker in most files, so edit the later position first
    const hasBinding = bindings.getProperty(binding) !== undefined
    const edits: Array<{ at: number; apply: (t: string) => string }> = []
    if (!hasBinding) {
      edits.push({
        at: bindings.getStart(),
        apply: (t) => {
          const o = findBindings(parseTs(ALCHEMY_FILE, t))
          if (!Node.isObjectLiteralExpression(o)) return t
          return appendListItem(
            t,
            o.getStart(),
            o.getEnd() - 1,
            o.getProperties().at(-1)?.getEnd(),
            entry,
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
