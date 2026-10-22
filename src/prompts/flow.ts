import { Effect, Schema } from "effect"
import { IncompatibleStack, validate } from "../rules.ts"
import { available, type OptionDef, slots, whyUnavailable } from "../slots.ts"
import { ProjectName, type SlotId, type StackConfig } from "../stack.ts"
import { GoBack, type PromptError, type PromptIOShape } from "./navigable.ts"

export class InvalidProjectName extends Schema.TaggedError<InvalidProjectName>()(
  "InvalidProjectName",
  { name: Schema.String, message: Schema.String },
) {}

/** Flag values as typed by the user: unvalidated strings. */
export interface StackFlags {
  readonly name?: string | undefined
  readonly runtime?: string | undefined
  readonly database?: string | undefined
  readonly orm?: string | undefined
  readonly auth?: string | undefined
  readonly infra?: string | undefined
  readonly ai?: string | undefined
  readonly extras?: ReadonlyArray<string> | undefined
}

export interface AskOptions {
  /** Accept defaults for everything a flag didn't set. */
  readonly yes?: boolean | undefined
  /** Extra check on the project name (e.g. the target directory is not empty), run while prompting. */
  readonly checkName?: ((name: string) => string | undefined) | undefined
}

export const DEFAULT_NAME = "my-app"

/** Names npm refuses, or that would shadow a well-known directory. */
const reserved = new Set(["node_modules", "favicon.ico", "test", "tests", "src", "dist"])

const nameError = (name: string): string | undefined => {
  if (name.length > 214) return `the name is ${name.length} characters; npm allows 214`
  if (reserved.has(name)) return `"${name}" is a reserved or confusing package name; pick another`
  const r = Schema.decodeUnknownExit(ProjectName)(name)
  return r._tag === "Success"
    ? undefined
    : name.includes("/") && !name.startsWith("@")
      ? `"${name}" is a path; run efforge from the parent directory and pass just the name`
      : `"${name}" isn't a valid npm package name: use lowercase letters, digits, - . _ ~ (optionally @scope/name)`
}

type Draft = Record<string, string | ReadonlyArray<string>>

const defaultFor = (slot: (typeof slots)[number], options: ReadonlyArray<OptionDef>) => {
  if (slot.multi) return [] as string[]
  const wanted = slot.default as string
  return options.some((o) => o.id === wanted) ? wanted : (options[0]?.id ?? wanted)
}

/**
 * Walks the slots in order. Flags skip their prompt but are validated against the
 * answers so far; a slot with a single available option is chosen silently.
 * `GoBack` returns to the previous slot that was actually prompted.
 */
export const askStack = (
  flags: StackFlags,
  io: PromptIOShape,
  opts: AskOptions = {},
): Effect.Effect<StackConfig, PromptError | IncompatibleStack | InvalidProjectName> =>
  Effect.gen(function* () {
    // 1. name
    let name = flags.name
    if (name === undefined) {
      if (opts.yes) name = DEFAULT_NAME
      else {
        const answer = yield* io.text({
          id: "name",
          message: "Project name",
          placeholder: DEFAULT_NAME,
          defaultValue: DEFAULT_NAME,
          validate: (n) => nameError(n) ?? opts.checkName?.(n),
        })
        name = answer === GoBack ? DEFAULT_NAME : answer
      }
    }
    const invalid = nameError(name)
    if (invalid !== undefined) return yield* new InvalidProjectName({ name, message: invalid })

    // 2. slots
    const draft: Draft = {}
    const previous: Draft = {}
    const history: number[] = []
    let section: string | undefined
    let i = 0
    while (i < slots.length) {
      const slot = slots[i] as (typeof slots)[number]
      const options = available(slot.id, draft)
      const ids = options.map((o) => o.id)
      const flag = flags[slot.id as keyof StackFlags]

      if (flag !== undefined) {
        const values = typeof flag === "string" ? [flag] : flag
        for (const value of values) {
          if (!ids.includes(value)) {
            const reason = whyUnavailable(slot.id, value, draft)
            return yield* new IncompatibleStack(
              reason === undefined
                ? { slot: slot.id, value, allowed: ids }
                : { slot: slot.id, value, allowed: ids, reason },
            )
          }
        }
        draft[slot.id] = slot.multi ? [...new Set(values)] : flag
        i++
        continue
      }
      if (opts.yes || (!slot.multi && options.length <= 1)) {
        draft[slot.id] = defaultFor(slot, options)
        i++
        continue
      }

      if (section !== slot.section) {
        section = slot.section
        yield* io.section(slot.section)
      }
      const choices = options.map((o) => ({ value: o.id, label: o.label, hint: o.hint }))
      const canGoBack = history.length > 0
      const prev = previous[slot.id]
      const answer = slot.multi
        ? yield* io.multiselect({
            id: slot.id,
            message: slot.title,
            options: choices,
            initial: (prev as ReadonlyArray<string> | undefined) ?? (slot.default as string[]),
            canGoBack,
          })
        : yield* io.select({
            id: slot.id,
            message: slot.title,
            options: choices,
            initial: (prev as string | undefined) ?? (defaultFor(slot, options) as string),
            canGoBack,
          })

      if (answer === GoBack) {
        const back = history.pop()
        if (back === undefined) continue // cannot happen: first prompt has no Back; re-ask
        for (let j = back; j < slots.length; j++) delete draft[(slots[j] as { id: SlotId }).id]
        section = undefined
        i = back
        continue
      }
      draft[slot.id] = answer
      previous[slot.id] = answer
      history.push(i)
      i++
    }

    return yield* validate({ name, ...draft } as unknown as StackConfig)
  })
