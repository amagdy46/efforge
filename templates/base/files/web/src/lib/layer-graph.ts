/** One argument of `Layer.mergeAll(...)` in layers.ts. */
export interface LayerEntry {
  /** The layer's name, e.g. `RealtimeLive` or `Logger.layer` */
  readonly name: string
  /** Layers provided to it in layers.ts with `Layer.provide(...)` */
  readonly provided: ReadonlyArray<string>
}

/** Splits at top-level commas, skipping brackets, strings and comments. */
const splitArgs = (text: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let current = ""
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i)
    if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1 || text.length
      continue
    }
    if (c === "/" && text[i + 1] === "/") {
      i = text.indexOf("\n", i) === -1 ? text.length : text.indexOf("\n", i)
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      const end = text.indexOf(c, i + 1)
      current += text.slice(i, end + 1)
      i = end === -1 ? text.length : end
      continue
    }
    if ("([{".includes(c)) depth++
    if (")]}".includes(c)) depth--
    if (c === "," && depth === 0) {
      parts.push(current.trim())
      current = ""
    } else current += c
  }
  parts.push(current.trim())
  return parts.filter((part) => part !== "")
}

/**
 * The layers that `AppLayer = Layer.mergeAll(...)` merges, read from the source of layers.ts, so
 * the graph shows the composition as it is, including layers you add by hand.
 */
export const parseAppLayer = (source: string): LayerEntry[] => {
  const start = /AppLayer\s*=\s*Layer\.mergeAll\(/.exec(source)
  if (start === null) return []
  let depth = 1
  let end = start.index + start[0].length
  for (; end < source.length && depth > 0; end++) {
    if (source[end] === "(") depth++
    if (source[end] === ")") depth--
  }
  return splitArgs(source.slice(start.index + start[0].length, end - 1)).map((arg) => ({
    name: /^[\w$.]+/.exec(arg)?.[0].replace(/\.pipe$/, "") ?? arg,
    provided: [...arg.matchAll(/Layer\.provide(?:Merge)?\(\s*([\w$.]+)/g)].map((m) => m[1] ?? ""),
  }))
}
