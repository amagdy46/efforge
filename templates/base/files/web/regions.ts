import { existsSync, readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { type Plugin, parseSync } from "vite"

const START = /^\s*\/\/ #region (\S+)\s*$/
const END = /^\s*\/\/ #endregion\b/
const QUERY = /\?region=([\w-]+)$/

/** Files whose markers are read as code: only a real `//` comment is one. */
const CODE = /\.[cm]?[jt]sx?$/

/**
 * The numbers of the lines of `source` that start a real `//` comment, parsed as `file` (a
 * `// #region` line inside a template string or a string is text, not a marker); undefined for a
 * file that is not JavaScript or TypeScript, whose markers are read line by line.
 */
const commentLines = (source: string, file: string): Set<number> | undefined => {
  if (!CODE.test(file)) return undefined
  const starts = [0]
  for (let i = source.indexOf("\n"); i !== -1; i = source.indexOf("\n", i + 1)) starts.push(i + 1)
  const lineOf = (offset: number) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if ((starts[mid] ?? 0) <= offset) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  return new Set(
    parseSync(file, source)
      .comments.filter((c) => c.type === "Line")
      .map((c) => lineOf(c.start)),
  )
}

/**
 * The lines between `// #region <name>` and the next `// #endregion` in `source`, without their
 * common indent, or undefined when the file has no such region. A region that reaches another
 * `// #region` before its `// #endregion` is not one: it would ship the next region too. In a
 * JavaScript or TypeScript `file` the markers are comments the parser sees, so a marker line
 * inside a template string is part of the string.
 */
export const region = (source: string, name: string, file = "source.ts"): string | undefined => {
  const lines = source.split("\n")
  const comments = commentLines(source, file)
  const marker = (pattern: RegExp, line: string, at: number) =>
    pattern.test(line) && (comments === undefined || comments.has(at))
  const start = lines.findIndex(
    (line, at) => marker(START, line, at) && START.exec(line)?.[1] === name,
  )
  if (start === -1) return undefined
  const body = lines.slice(start + 1)
  const end = body.findIndex((line, at) => marker(END, line, start + 1 + at))
  if (end === -1) return undefined
  const picked = body.slice(0, end)
  if (picked.some((line, at) => marker(START, line, start + 1 + at))) return undefined
  const indent = Math.min(
    ...picked
      .filter((line) => line.trim() !== "")
      .map((line) => /^\s*/.exec(line)?.[0].length ?? 0),
  )
  return picked
    .map((line) => line.slice(Number.isFinite(indent) ? indent : 0))
    .join("\n")
    .trim()
}

/**
 * `import source from "./file.ts?region=card"` is the `card` region of that file as a string, and
 * nothing else: the rest of the file never reaches the browser. A file without the region fails the
 * build. Capability cards show their code this way (docs/capability-cards.md in the efforge repo);
 * `pnpm dev` reloads the card when the file changes.
 */
export const regions = (): Plugin => ({
  name: "efforge:regions",
  enforce: "pre",
  async load(id) {
    const query = QUERY.exec(id)
    if (query === null) return null
    const file = id.slice(0, query.index)
    const name = query[1] ?? "card"
    this.addWatchFile(file)
    const text = region(await readFile(file, "utf8"), name, file)
    if (text === undefined)
      this.error(
        `${file} has no complete "// #region ${name}" ... "// #endregion" block (a region ends at its own #endregion and holds no other #region). A card shows only a marked region of a file, so mark the part to show.`,
      )
    return `export default ${JSON.stringify(text)}\n`
  },
})

/** Local settings files: `.dev.vars` (wrangler) and `.env`, `.env.local`, ... (Alchemy, Vite). */
const SETTINGS_FILE = /^\.(?:dev\.vars|env)(?:\.[\w.-]+)?$/
/** Settings whose values are secrets, by name. */
const SECRET_NAME = /SECRET|KEY|TOKEN|PASSWORD|PRIVATE/

/** The secret values in the settings files of `dirs`, as `[name, value]`. */
export const secretValues = (dirs: ReadonlyArray<string>): Array<[string, string]> =>
  dirs.flatMap((dir) =>
    [".dev.vars", ".env", ".env.local", ".env.production"]
      .map((name) => join(dir, name))
      .filter((file) => existsSync(file))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .map((line) => /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line))
          .filter((m): m is RegExpExecArray => m !== null)
          .map((m): [string, string] => [m[1] ?? "", (m[2] ?? "").trim()])
          .filter(([name, value]) => SECRET_NAME.test(name) && value.length >= 8),
      ),
  )

/**
 * Why a module in the browser build is the whole of a file that must stay on the server, or
 * undefined: a settings file (`.dev.vars`, `.env*`) in any form, or a file under `src/server/`
 * imported with a query that turns it into its text, a URL or a data URL (`?raw`, `?url`,
 * `?inline`). Server functions under `src/server/` are fine: the browser gets a stub that calls the
 * server, and `?region=` gets only the marked region.
 */
export const wholeServerFile = (id: string): string | undefined => {
  const at = id.indexOf("?")
  const file = at === -1 ? id : id.slice(0, at)
  const query = at === -1 ? "" : id.slice(at + 1)
  if (SETTINGS_FILE.test(basename(file))) return `${file} is a settings file`
  if (!file.includes("/src/server/") || query === "") return undefined
  const kind = query
    .split("&")
    .find((part) => /^(?:raw|url|inline|worker|sharedworker)$/.test(part))
  return kind === undefined ? undefined : `${file} is imported whole (?${kind})`
}

/** An asset's content as text. */
const assetText = (source: string | Uint8Array): string =>
  typeof source === "string" ? source : new TextDecoder().decode(source)

/**
 * Fails the browser build when it would ship a secret: a module that is a whole server file or a
 * settings file (see `wholeServerFile`), or the value of a secret from `.dev.vars` or `.env*`
 * (`root` and the app's own directory) anywhere in the output. Lint stops such imports earlier
 * (`efforge/no-whole-file-import`); this catches the ones it cannot see.
 */
export const clientGuard = (root = "../.."): Plugin => ({
  name: "efforge:client-guard",
  applyToEnvironment: (environment) => environment.config.consumer === "client",
  generateBundle(_options, bundle) {
    const secrets = secretValues([process.cwd(), join(process.cwd(), root)])
    for (const output of Object.values(bundle)) {
      const ids = output.type === "chunk" ? output.moduleIds : (output.originalFileNames ?? [])
      for (const id of ids) {
        const problem = wholeServerFile(id)
        if (problem !== undefined) {
          const importers = this.getModuleInfo(id)?.importers ?? []
          this.error(
            `${problem}, and the browser build would ship it in ${output.fileName}${importers.length > 0 ? ` (imported by ${importers.join(", ")})` : ""}. Read it on the server, or show code with ?region=card.`,
          )
        }
      }
      const text = output.type === "chunk" ? output.code : assetText(output.source)
      for (const [name, value] of secrets)
        if (text.includes(value))
          this.error(
            `The value of ${name} (from .dev.vars or .env) is in ${output.fileName}, which ships to the browser. Find the import that reaches a settings file and remove it.`,
          )
    }
  },
})
