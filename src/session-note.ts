import { PUBLIC_LIST_FILE, SERVER_DIR, START_FILE } from "./cards.ts"
import { unguardedServerFns } from "./transforms/addServerFnMiddleware.ts"

/** A server function that runs without `requireSession`, by name and file. */
export interface Unguarded {
  readonly name: string
  readonly file: string
}

/** The project's public list (`public-server-fns.json`), or nothing when it is missing or malformed. */
export const publicList = (
  text: string | undefined,
): Readonly<Record<string, ReadonlyArray<string>>> => {
  if (text === undefined) return {}
  try {
    const list = JSON.parse(text) as unknown
    if (typeof list !== "object" || list === null || Array.isArray(list)) return {}
    return Object.fromEntries(
      Object.entries(list).filter(
        (e): e is [string, string[]] =>
          Array.isArray(e[1]) && e[1].every((n) => typeof n === "string"),
      ),
    )
  } catch {
    return {}
  }
}

/**
 * The server functions in `files` (path and text, under apps/web/src) that chain no
 * `requireSession` and are not on the public list: what `pnpm check` fails on
 * (`efforge/server-fn-session`) once the project has auth. Exported or not, in a route file too.
 */
export const unguardedIn = (
  files: Iterable<readonly [string, string]>,
  list: Readonly<Record<string, ReadonlyArray<string>>>,
): Unguarded[] => {
  const found: Unguarded[] = []
  for (const [file, text] of files) {
    if (!/\.tsx?$/.test(file) || file.endsWith(".d.ts") || !text.includes("createServerFn"))
      continue
    for (const name of unguardedServerFns(file, text, "requireSession"))
      if (!(list[file] ?? []).includes(name)) found.push({ name, file })
  }
  return found
}

/**
 * What changed when the session gates arrived (`add auth`, or `upgrade` adding them to a project
 * made before them), for server functions and for routes, with the functions `pnpm check` now
 * fails on. One line, the same in text and `--json`.
 */
export const sessionNote = (unguarded: ReadonlyArray<Unguarded>): string => {
  const named = unguarded.map((f) => `${f.name} (${f.file})`).join(", ")
  return [
    `Every server function now requires a session: sessionGate runs before each one (${START_FILE}), and a signed-out call gets Unauthorized.`,
    unguarded.length > 0
      ? `Yours too, and pnpm check fails on each of them until it chains .middleware([requireSession]) (efforge/server-fn-session): ${named}.`
      : "Yours too, including any you write later; pnpm check fails on one that does not chain .middleware([requireSession]) (efforge/server-fn-session).",
    `To let signed-out visitors call one, add its file and name to ${PUBLIC_LIST_FILE}, as getSession and getStack are.`,
    `Every request under /api/ now requires a session too (requireApiSession, first in workerRoutes), whether a Worker route or a route file answers it; only the paths in ${SERVER_DIR}public-api-paths.json (/api/auth/) do not.`,
    `A route outside /api/ is not checked: it checks the session itself, with signedIn(request.headers) from ${SERVER_DIR}socket-session.ts.`,
  ].join(" ")
}
