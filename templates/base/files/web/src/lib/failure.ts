import type { Failure } from "./outcome"

/** One issue from a Standard Schema validator, as the server function rejects with it. */
interface Issue {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>
}

const isIssues = (value: unknown): value is ReadonlyArray<Issue> =>
  Array.isArray(value) &&
  value.every(
    (issue: unknown) =>
      typeof issue === "object" &&
      issue !== null &&
      "message" in issue &&
      typeof issue.message === "string",
  )

const issues = (message: string): ReadonlyArray<Issue> | undefined => {
  if (!message.startsWith("[")) return undefined
  try {
    const parsed: unknown = JSON.parse(message)
    return isIssues(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * A call the server rejected, as a `Failure`. A tagged error keeps its `_tag` and message
 * (`Unauthorized` from `requireSession`, `NotConfigured`); input the validator refused is
 * `InvalidInput` with its messages; a server that did not answer is `Unreachable`; anything else is
 * a `Defect`, a bug to fix rather than a state to show.
 */
export const asFailure = (error: unknown): Failure => {
  if (!(error instanceof Error)) return { _tag: "Defect", message: String(error) }
  if ("_tag" in error && typeof error._tag === "string")
    return { _tag: error._tag, message: error.message || error._tag }
  const invalid = issues(error.message)
  if (invalid !== undefined)
    return {
      _tag: "InvalidInput",
      message: invalid
        .map(({ message, path = [] }) => {
          const at = path.map((p) => String(typeof p === "object" ? p.key : p)).join(".")
          return at === "" ? message : `${at}: ${message}`
        })
        .join("; "),
    }
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message))
    return { _tag: "Unreachable", message: "The server did not answer. Is pnpm dev running?" }
  return { _tag: "Defect", message: error.message }
}
