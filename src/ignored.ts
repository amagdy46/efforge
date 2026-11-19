import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

// A project that isn't its own git repository lives under the ignore rules of the repository
// around it. When those ignore the project (a dotfiles repo in ~ with `*` in its .gitignore), the
// formatter sees no files (`pnpm check`: "Expected at least one target file") and Tailwind scans
// none, so the app renders unstyled. efforge can't change the parent; it can say so.

/**
 * The ignore rule that hides the project in `dir` (`* in /home/me/.gitignore`), asked of git for
 * its package.json; undefined when nothing ignores it, `dir` is its own repository, it is in no
 * repository, or git isn't there to ask. `dir` need not exist yet.
 */
export const ignoredBy = (dir: string): string | undefined => {
  const cwd = nearestExisting(dir)
  const r = spawnSync("git", ["check-ignore", "-v", "--", join(dir, "package.json")], {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
  })
  // 0: ignored; 1: not ignored; 128: not in a repository (or git failed)
  if (r.error !== undefined || r.status !== 0) return undefined
  const line = r.stdout.split("\n")[0] ?? ""
  // `<source>:<line>:<pattern>\t<path>`; a negated pattern (`!x`) matched means not ignored
  // anything but git's own answer (a stub, a wrapper) says nothing
  const m = /^(.*):(\d+):(.*)$/.exec(line.split("\t")[0] ?? "")
  if (m === null) return undefined
  const [, source, , pattern] = m as unknown as [string, string, string, string]
  if (pattern.startsWith("!")) return undefined
  // a .gitignore's path is relative to the repository's root; core.excludesFile's is absolute
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" })
  const root = top.status === 0 ? top.stdout.trim() : cwd
  return `${pattern} in ${resolve(root, source)}`
}

/** `dir`, or its nearest ancestor that exists (git needs a working directory). */
const nearestExisting = (dir: string): string => {
  let d = dir
  while (!existsSync(d) && dirname(d) !== d) d = dirname(d)
  return d
}

/** One line saying what is wrong and what to run, for create and doctor. */
export const ignoredMessage = (where: string, rule: string): string =>
  `${where} is ignored by git (the rule ${rule}), so pnpm check sees no files and Tailwind styles nothing. Run git init in the project to give it its own ignore rules.`
