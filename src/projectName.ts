import { applyEdits, modify, type ParseError, parse } from "jsonc-parser"
import type { Tree } from "./tree.ts"

const formattingOptions = { insertSpaces: true, tabSize: 2 }

const ALCHEMY_RUN = "infra/alchemy.run.ts"

/** Stack names end up in Cloudflare resource names: lowercase letters, digits and dashes. */
const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "app"

/** The directory name a project is created in: the last segment of a scoped name. */
export const projectDirName = (name: string): string => name.split("/").pop() ?? name

/**
 * Built-in post-step: names the generated project. Sets the root `package.json` (`<name>-monorepo`, so it can never clash with a workspace package called `<name>`) and
 * `wrangler.jsonc` `name`, the Alchemy stack name and the README's first heading. Files that are absent, or lack
 * the field, are left alone; running it twice changes nothing.
 */
export const applyProjectName = (tree: Tree, name: string): Tree => {
  const out = new Map(tree)
  const dir = projectDirName(name)

  const pkg = out.get("package.json")
  if (pkg !== undefined) {
    try {
      const parsed = JSON.parse(pkg) as Record<string, unknown>
      out.set(
        "package.json",
        `${JSON.stringify({ ...parsed, name: `${dir}-monorepo` }, null, 2)}\n`,
      )
    } catch {}
  }

  const wrangler = out.get("wrangler.jsonc")
  if (wrangler !== undefined) {
    const errors: ParseError[] = []
    const doc = parse(wrangler, errors, { allowTrailingComma: true }) as { name?: unknown } | null
    if (errors.length === 0 && typeof doc?.name === "string")
      out.set(
        "wrangler.jsonc",
        applyEdits(wrangler, modify(wrangler, ["name"], dir, { formattingOptions })),
      )
  }

  const readme = out.get("README.md")
  if (readme !== undefined) out.set("README.md", readme.replace(/^# .*$/m, `# ${dir}`))

  const alchemy = out.get(ALCHEMY_RUN)
  if (alchemy !== undefined)
    out.set(ALCHEMY_RUN, alchemy.replace(/(Alchemy\.Stack\(\s*)"[^"]*"/, `$1"${slug(dir)}"`))

  return out
}
