// Two rules that keep what the server holds on the server. Both are configured in vite.config.ts.
import { existsSync } from "node:fs"
import { join, relative, sep } from "node:path"

/** `file` relative to the project root, with forward slashes. */
const projectPath = (context) => relative(context.cwd, context.filename).split(sep).join("/")

/**
 * How `createServerFn` from `@tanstack/react-start` is reachable in a file: the local names it is
 * imported as, and the namespaces the package is imported as (`Start.createServerFn`).
 */
const serverFnNames = (program) => {
  const names = new Set()
  const namespaces = new Set()
  for (const node of program.body) {
    if (node.type !== "ImportDeclaration" || node.source.value !== "@tanstack/react-start") continue
    for (const spec of node.specifiers) {
      if (spec.type === "ImportSpecifier" && spec.imported.name === "createServerFn")
        names.add(spec.local.name)
      if (spec.type === "ImportNamespaceSpecifier") namespaces.add(spec.local.name)
    }
  }
  return { names, namespaces }
}

/** Whether `callee` is `createServerFn`, by one of its local names or through a namespace. */
const isServerFn = (callee, { names, namespaces }) =>
  (callee.type === "Identifier" && names.has(callee.name)) ||
  (callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    namespaces.has(callee.object.name) &&
    callee.property.name === "createServerFn")

/** The calls chained on `call`: `createServerFn(...).middleware([...]).handler(...)`. */
const chainOf = (call) => {
  const links = []
  let top = call
  for (;;) {
    const access = top.parent
    const outer = access?.parent
    if (
      access?.type !== "MemberExpression" ||
      access.object !== top ||
      outer?.type !== "CallExpression" ||
      outer.callee !== access
    )
      return { links, top }
    links.push({ name: access.property.name, args: outer.arguments })
    top = outer
  }
}

/** The name a server function is exported as: `export const <name> = createServerFn(...)...`. */
const nameOf = (top) => {
  let node = top.parent
  while (node !== undefined && node !== null && node.type !== "VariableDeclarator") {
    if (node.type === "Program" || node.type.endsWith("Statement")) return undefined
    node = node.parent
  }
  return node?.id?.type === "Identifier" ? node.id.name : undefined
}

const serverFnSession = {
  meta: {
    type: "problem",
    docs: { description: "On a project with auth, every server function requires a session" },
    schema: [
      {
        type: "object",
        properties: {
          guard: { type: "string" },
          middleware: { type: "string" },
          public: {
            type: "object",
            additionalProperties: { type: "array", items: { type: "string" } },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = context.options[0] ?? {}
    const guard = options.guard ?? "apps/web/src/server/require-session.ts"
    const middleware = options.middleware ?? "requireSession"
    // without auth there is no session to require: the rule switches on with the guard's file
    if (!existsSync(join(context.cwd, guard))) return {}
    const file = projectPath(context)
    const open = new Set(options.public?.[file] ?? [])
    let imported = { names: new Set(), namespaces: new Set() }
    return {
      Program(program) {
        imported = serverFnNames(program)
      },
      CallExpression(node) {
        if (!isServerFn(node.callee, imported)) return
        const { links, top } = chainOf(node)
        const name = nameOf(top)
        if (name !== undefined && open.has(name)) return
        const guarded = links.some(
          (link) =>
            link.name === "middleware" &&
            link.args[0]?.type === "ArrayExpression" &&
            link.args[0].elements.some((e) => e?.type === "Identifier" && e.name === middleware),
        )
        if (guarded) return
        const fn = name === undefined ? "This server function" : `\`${name}\``
        context.report({
          node,
          message: `${fn} in ${file} runs without a session. This project has auth (${guard}), so every server function needs one: chain \`.middleware([${middleware}])\` right after \`createServerFn(...)\`, with \`import { ${middleware} } from "@/server/require-session"\`. A function that must answer signed-out visitors goes on the \`public\` list of the efforge/server-fn-session rule in vite.config.ts.`,
        })
      },
    }
  },
}

// Vite queries that turn an import into a whole file: its text (?raw), a copy in the public
// assets (?url), a data URL (?inline), or a worker. Cards show code through ?region=<name>
// (apps/web/regions.ts) instead, which ships only the marked region.
const REGION = /^region=[\w-]+$/

const importProblem = (source) => {
  const at = source.indexOf("?")
  if (at === -1) return undefined
  const query = source.slice(at + 1)
  if (REGION.test(query)) return undefined
  // a stylesheet is public by nature (routes/__root.tsx links styles.css?url)
  if (query === "url" && source.slice(0, at).endsWith(".css")) return undefined
  return `\`${source}\` imports a whole file (?${query}), which ships it to the browser if any client code reaches it. Show code with ?region=card and a "// #region card" block in the file (apps/web/regions.ts), or read the file on the server.`
}

const noWholeFileImport = {
  meta: {
    type: "problem",
    docs: { description: "Only ?region=<name> may import a source file as text" },
    schema: [
      {
        type: "object",
        properties: {
          allow: {
            type: "object",
            additionalProperties: { type: "array", items: { type: "string" } },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const allowed = new Set(context.options[0]?.allow?.[projectPath(context)] ?? [])
    const check = (node, source) => {
      if (typeof source !== "string" || allowed.has(source)) return
      const message = importProblem(source)
      if (message !== undefined) context.report({ node, message })
    }
    const fromLiteral = (node) => {
      if (node.source?.type === "Literal") check(node, node.source.value)
    }
    return {
      ImportDeclaration: fromLiteral,
      ExportNamedDeclaration: fromLiteral,
      ExportAllDeclaration: fromLiteral,
      ImportExpression: fromLiteral,
      // import.meta.glob("./*.ts", { query: "?raw" }) or { as: "raw" }
      CallExpression(node) {
        const callee = node.callee
        if (
          callee.type !== "MemberExpression" ||
          callee.object.type !== "MetaProperty" ||
          !String(callee.property.name).startsWith("glob")
        )
          return
        for (const prop of node.arguments[1]?.properties ?? []) {
          const key = prop.key?.name ?? prop.key?.value
          const value = prop.value?.type === "Literal" ? prop.value.value : undefined
          if (key === "query" && typeof value === "string")
            check(node, `glob${value.startsWith("?") ? value : `?${value}`}`)
          if (key === "as" && typeof value === "string") check(node, `glob?${value}`)
        }
      },
    }
  },
}

export default {
  meta: { name: "efforge" },
  rules: {
    "server-fn-session": serverFnSession,
    "no-whole-file-import": noWholeFileImport,
  },
}
