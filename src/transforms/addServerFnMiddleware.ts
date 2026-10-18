import { Effect } from "effect"
import { type CallExpression, Node } from "ts-morph"
import { addImportText, missing, parseTs, req, type Transform, withFile } from "./util.ts"

/** The outermost call of the chain `call` belongs to (`createServerFn(...).validator(...).handler(...)`). */
const chainTop = (call: CallExpression): Node => {
  let top: Node = call
  for (;;) {
    const access = top.getParent()
    const outer = access?.getParent()
    if (
      Node.isPropertyAccessExpression(access) &&
      access.getExpression() === top &&
      Node.isCallExpression(outer) &&
      outer.getExpression() === access
    )
      top = outer
    else return top
  }
}

/**
 * args: `{ file, middleware, import?, from? }` — adds `.middleware([<middleware>])` right after
 * every `createServerFn(...)` in `file`, so those server functions run behind that TanStack Start
 * middleware (for example an auth gate). A function that already calls `.middleware(...)` is left
 * alone, and the import is added when `import` and `from` are given. Idempotent.
 */
export const addServerFnMiddleware: Transform = (tree, args) =>
  Effect.gen(function* () {
    const file = req(args, "file", "addServerFnMiddleware")
    const middleware = req(args, "middleware", "addServerFnMiddleware")
    const snippet = `In ${file}, chain the middleware on every server function:\n  createServerFn({ method: "POST" }).middleware([${middleware}])...`
    const text = tree.get(file)
    if (text === undefined) return yield* missing(file, "file", snippet)

    const sf = parseTs(file, text)
    const calls = sf
      .getDescendants()
      .filter(
        (n): n is CallExpression =>
          Node.isCallExpression(n) && n.getExpression().getText() === "createServerFn",
      )
    if (calls.length === 0) return yield* missing(file, "createServerFn(...)", snippet)

    const inserts: number[] = []
    for (const call of calls) {
      const top = chainTop(call)
      const gated = top
        .getDescendants()
        .some(
          (n) =>
            Node.isPropertyAccessExpression(n) &&
            n.getName() === "middleware" &&
            n.getExpression().getText().startsWith("createServerFn"),
        )
      if (!gated) inserts.push(call.getEnd())
    }
    let next = text
    for (const at of inserts.toSorted((a, b) => b - a)) {
      // a chain the formatter already broke one call per line gets the new call on its own line
      const broken = /^[ \t]*\r?\n([ \t]*)\./.exec(next.slice(at))
      const call = `.middleware([${middleware}])`
      next =
        broken === null
          ? `${next.slice(0, at)}${call}${next.slice(at)}`
          : `${next.slice(0, at)}${next.includes("\r\n") ? "\r\n" : "\n"}${broken[1]}${call}${next.slice(at)}`
    }
    if (args.import !== undefined && args.from !== undefined)
      next = addImportText(file, next, args.import, args.from) ?? next
    return withFile(tree, file, next)
  })
