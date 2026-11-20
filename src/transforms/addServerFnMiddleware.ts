import { Effect } from "effect"
import { type CallExpression, Node } from "ts-morph"
import { addImportText, missing, parseTs, req, type Transform, withFile } from "./util.ts"

/** The calls of the chain `call` starts (`createServerFn(...).validator(...).handler(...)`), in order. */
const chain = (call: CallExpression): Node[] => {
  const calls: Node[] = [call]
  for (;;) {
    const top = calls.at(-1) as Node
    const access = top.getParent()
    const outer = access?.getParent()
    if (
      Node.isPropertyAccessExpression(access) &&
      access.getExpression() === top &&
      Node.isCallExpression(outer) &&
      outer.getExpression() === access
    )
      calls.push(outer)
    else return calls
  }
}

const PRINT_WIDTH = 100

/**
 * The rest of a one-line chain (`.handler(...)` and any other calls after `createServerFn(...)`)
 * with `call` first, one call per line, laid out as the generated project's formatter does: a
 * call's arguments go on one line when they fit, else its later lines move in by one indent.
 */
const oneCallPerLine = (text: string, calls: Node[], call: string, eol: string): string => {
  const start = (calls[0] as Node).getEnd()
  const lineStart = text.lastIndexOf("\n", start) + 1
  const indent = `${/^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? ""}  `
  const rest = calls.slice(1).map((c, i) => text.slice((calls[i] as Node).getEnd(), c.getEnd()))
  const lines = [call, ...rest].map((part) => {
    const parts = part.split(/\r?\n/)
    if (parts.length === 1) return part
    // `.handler(() =>`, its body, `)`: one line when it fits and nothing in it depends on newlines
    const [first, ...tail] = parts as [string, ...string[]]
    const body = tail.slice(0, -1).map((l) => l.trim())
    if (first.endsWith("=>") && tail.at(-1)?.trim() === ")" && !/`|\/\/|\/\*/.test(part)) {
      const flat = `${first} ${body.join(" ").replace(/,$/, "")})`
      if (indent.length + flat.length <= PRINT_WIDTH) return flat
    }
    return [first, ...tail.map((l) => (l === "" ? l : `  ${l}`))].join(eol)
  })
  return lines.map((l) => `${eol}${indent}${l}`).join("")
}

/** The `.middleware(...)` call of a chain, if it has one. */
const middlewareCall = (links: Node[]): CallExpression | undefined =>
  links.find((n): n is CallExpression => {
    if (!Node.isCallExpression(n)) return false
    const callee = n.getExpression()
    return Node.isPropertyAccessExpression(callee) && callee.getName() === "middleware"
  })

/** The `createServerFn(...)` calls in `text`. */
const serverFnCalls = (file: string, text: string): CallExpression[] =>
  parseTs(file, text)
    .getDescendants()
    .filter(
      (n): n is CallExpression =>
        Node.isCallExpression(n) && n.getExpression().getText() === "createServerFn",
    )

/** The name a chain is exported as (`export const greet = createServerFn(...)...`). */
const nameOf = (top: Node): string =>
  top
    .getFirstAncestor((n) => Node.isVariableDeclaration(n))
    ?.getSymbol()
    ?.getName() ?? "a server function"

/**
 * The server functions in `text` whose chain has no `.middleware([...])` list naming `middleware`,
 * by name. `add` reports each one it could not guard (the list is not written out, so it cannot
 * add to it): the generated project's own lint rule fails on them too.
 */
export const unguardedServerFns = (file: string, text: string, middleware: string): string[] =>
  serverFnCalls(file, text).flatMap((fn) => {
    const links = chain(fn)
    const list = middlewareCall(links)?.getArguments()[0]
    const guarded =
      list !== undefined &&
      Node.isArrayLiteralExpression(list) &&
      list.getElements().some((e) => e.getText() === middleware)
    return guarded ? [] : [nameOf(links.at(-1) as Node)]
  })

/**
 * args: `{ file, middleware, import?, from?, ifAny? }` — puts `<middleware>` on every
 * `createServerFn(...)` in `file`, so those server functions run behind that TanStack Start
 * middleware (for example an auth gate): `.middleware([<middleware>])` right after the call, or,
 * when the chain already has a `.middleware([...])` list, first in that list. A chain whose
 * `.middleware(...)` is not a written-out list is left alone (`unguardedServerFns` names it). The
 * import is added when `import` and `from` are given. With `ifAny`, a file without a server
 * function is left as it is instead of failing. Idempotent.
 */
export const addServerFnMiddleware: Transform = (tree, args) =>
  Effect.gen(function* () {
    const file = req(args, "file", "addServerFnMiddleware")
    const middleware = req(args, "middleware", "addServerFnMiddleware")
    const snippet = `In ${file}, chain the middleware on every server function:\n  createServerFn({ method: "POST" }).middleware([${middleware}])...`
    const text = tree.get(file)
    if (text === undefined) return yield* missing(file, "file", snippet)

    const calls = serverFnCalls(file, text)
    if (calls.length === 0)
      return args.ifAny === "true" ? tree : yield* missing(file, "createServerFn(...)", snippet)

    // [start, end, replacement], applied from the end of the file
    const edits: Array<[number, number, string]> = []
    const call = `.middleware([${middleware}])`
    const eol = text.includes("\r\n") ? "\r\n" : "\n"
    for (const fn of calls) {
      const links = chain(fn)
      const top = links.at(-1) as Node
      const existing = middlewareCall(links)
      if (existing !== undefined) {
        const list = existing.getArguments()[0]
        if (list === undefined || !Node.isArrayLiteralExpression(list)) continue
        const items = list.getElements()
        if (items.some((e) => e.getText() === middleware)) continue
        // first in the list: the session is checked before any other middleware runs
        const at = list.getStart() + 1
        edits.push([at, at, items.length === 0 ? middleware : `${middleware}, `])
        continue
      }
      const at = fn.getEnd()
      // a chain the formatter already broke one call per line gets the new call on its own line
      const broken = /^[ \t]*\r?\n([ \t]*)\./.exec(text.slice(at))
      if (broken !== null) edits.push([at, at, `${eol}${broken[1]}${call}`])
      else if (top === fn) edits.push([at, at, call])
      // a one-line chain of two calls becomes three, which the formatter puts one per line
      else edits.push([at, top.getEnd(), oneCallPerLine(text, links, call, eol)])
    }
    let next = text
    for (const [start, end, replacement] of edits.toSorted((a, b) => b[0] - a[0]))
      next = `${next.slice(0, start)}${replacement}${next.slice(end)}`
    const uses = unguardedServerFns(file, next, middleware).length < calls.length
    if (uses && args.import !== undefined && args.from !== undefined)
      next = addImportText(file, next, args.import, args.from) ?? next
    return withFile(tree, file, next)
  })
