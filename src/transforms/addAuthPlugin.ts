import { Effect } from "effect"
import { type ArrayLiteralExpression, type CallExpression, Node, SyntaxKind } from "ts-morph"
import {
  addImportText,
  appendListItem,
  missing,
  parseTs,
  req,
  type Transform,
  withFile,
} from "./util.ts"

export const AUTH_FILE = "apps/web/src/server/auth.ts"

const calleeName = (expr: string) => /^\s*([\w.$]+)\s*\(/.exec(expr)?.[1]

const findPlugins = (text: string): ArrayLiteralExpression | undefined => {
  const sf = parseTs(AUTH_FILE, text)
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== "betterAuth") continue
    const obj = call.getArguments()[0]
    if (!Node.isObjectLiteralExpression(obj)) continue
    const prop = obj.getProperty("plugins")
    if (Node.isPropertyAssignment(prop)) {
      const init = prop.getInitializer()
      if (Node.isArrayLiteralExpression(init)) return init
    }
  }
  return undefined
}

const withImport = (text: string, args: Readonly<Record<string, string>>): string => {
  if (args.import === undefined || args.from === undefined) return text
  return addImportText(AUTH_FILE, text, args.import, args.from) ?? text
}

/**
 * Append mode: `{ import, from, call }` appends `call` to `plugins: [...]` in betterAuth({...}).
 * Merge mode: `{ mergeInto, property, value, import?, from? }` adds `property: value` to the first
 * object argument of the existing `mergeInto(...)` plugin call. Both are idempotent.
 */
export const addAuthPlugin: Transform = (tree, args) =>
  Effect.gen(function* () {
    const text = tree.get(AUTH_FILE)
    const appendSnippet = `In ${AUTH_FILE}, inside betterAuth({ ... }):\n  plugins: [${args.call ?? args.mergeInto ?? ""}]`
    if (text === undefined) return yield* missing(AUTH_FILE, "file", appendSnippet)
    const plugins = findPlugins(text)
    if (plugins === undefined)
      return yield* missing(AUTH_FILE, "betterAuth({ plugins: [...] })", appendSnippet)

    if (args.mergeInto !== undefined) {
      const target = args.mergeInto
      const property = req(args, "property", "addAuthPlugin")
      const value = req(args, "value", "addAuthPlugin")
      const entry = property === value ? property : `${property}: ${value}`
      const snippet = `In ${AUTH_FILE}, in the ${target}(...) plugin options add:\n  ${entry}`
      const call = plugins
        .getElements()
        .find(
          (e): e is CallExpression =>
            Node.isCallExpression(e) && e.getExpression().getText() === target,
        )
      if (call === undefined) return yield* missing(AUTH_FILE, `${target}(...) plugin`, snippet)
      const first = call.getArguments()[0]
      if (first === undefined) {
        const open = text.indexOf("(", call.getExpression().getEnd())
        const next = `${text.slice(0, open + 1)}{ ${entry} }${text.slice(open + 1)}`
        return withFile(tree, AUTH_FILE, withImport(next, args))
      }
      if (!Node.isObjectLiteralExpression(first))
        return yield* missing(AUTH_FILE, `${target}({ ... }) options object`, snippet)
      if (first.getProperty(property) !== undefined) return tree
      const props = first.getProperties()
      const next = appendListItem(
        text,
        first.getStart(),
        first.getEnd() - 1,
        props.at(-1)?.getEnd(),
        entry,
      )
      return withFile(tree, AUTH_FILE, withImport(next, args))
    }

    const call = req(args, "call", "addAuthPlugin")
    const name = calleeName(call)
    const present = plugins
      .getElements()
      .some((e) =>
        name === undefined
          ? e.getText().replace(/\s+/g, "") === call.replace(/\s+/g, "")
          : Node.isCallExpression(e) && e.getExpression().getText() === name,
      )
    const next = present
      ? text
      : appendListItem(
          text,
          plugins.getStart(),
          plugins.getEnd() - 1,
          plugins.getElements().at(-1)?.getEnd(),
          call,
        )
    return withFile(tree, AUTH_FILE, withImport(next, args))
  })
