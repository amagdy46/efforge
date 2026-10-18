import { Effect, Schema } from "effect"
import { IncompatibleStack, validate } from "../rules.ts"
import { available, type OptionDef, slots } from "../slots.ts"
import { ProjectName, type SlotId, type StackConfig } from "../stack.ts"
import { type Cancelled, GoBack, type PromptIOShape } from "./navigable.ts"

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
}

export const DEFAULT_NAME = "my-app"

const nameError = (name: string): string | undefined => {
  const r = Schema.decodeUnknownExit(ProjectName)(name)
  return r._tag === "Success"
    ? undefined
    : "Use a valid npm package name: lowercase letters, digits, - . _ ~ (optionally @scope/name), no '..'"
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
): Effect.Effect<StackConfig, Cancelled | IncompatibleStack | InvalidProjectName> =>
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
          validate: nameError,
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
      const options = available(slot.id, draft as Partial<StackConfig>)
      const ids = options.map((o) => o.id)
      const flag = flags[slot.id as keyof StackFlags]

      if (flag !== undefined) {
        const values = typeof flag === "string" ? [flag] : flag
        for (const value of values) {
          if (!ids.includes(value)) {
            return yield* new IncompatibleStack({ slot: slot.id, value, allowed: ids })
          }
        }
        draft[slot.id] = slot.multi ? values : (flag as string)
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
