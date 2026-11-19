import { Effect, Schema } from "effect"
import { type Preset, presetById, presets } from "../presets.ts"
import { IncompatibleStack, validate } from "../rules.ts"
import { available, type OptionDef, slots, whyUnavailable } from "../slots.ts"
import { ProjectName, type SlotId, type StackConfig } from "../stack.ts"
import { GoBack, type PromptError, type PromptIOShape } from "./navigable.ts"

/** `--preset` named no preset. */
export class UnknownPreset extends Schema.TaggedError<UnknownPreset>()("UnknownPreset", {
  value: Schema.String,
  allowed: Schema.Array(Schema.String),
}) {}

export class InvalidProjectName extends Schema.TaggedError<InvalidProjectName>()(
  "InvalidProjectName",
  { name: Schema.String, message: Schema.String },
) {}

/** Flag values as typed by the user: unvalidated strings. */
export interface StackFlags {
  readonly name?: string | undefined
  /** A preset's id: its stack fills every slot no flag set. */
  readonly preset?: string | undefined
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
  /** Told which preset filled the stack (from the flag or the prompt), if any. */
  readonly onPreset?: ((preset: Preset) => void) | undefined
}

export const DEFAULT_NAME = "my-app"

/** Names npm refuses, or that would shadow a well-known directory. */
const reserved = new Set(["node_modules", "favicon.ico", "test", "tests", "src", "dist"])

export const nameError = (name: string): string | undefined => {
  if (name.length > 214) return `the name is ${name.length} characters; npm allows 214`
  if (reserved.has(name)) return `"${name}" is a reserved or confusing package name; pick another`
  if (name.startsWith("-"))
    return `"${name}" starts with -, so every command would read it as a flag; pick a name that starts with a letter or digit`
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

/** The preset prompt's answer for "choose each part". */
export const CUSTOM = "custom"

/** The choices of the preset prompt: each preset, then "choose each part". */
export const presetChoices = () => [
  ...presets.map((p) => ({ value: p.id, label: p.title, hint: p.description })),
  {
    value: CUSTOM,
    label: "Choose each part",
    hint: "database, ORM, auth, infrastructure, AI, extras",
  },
]

/**
 * Asks for the name, then (when no stack flag and no `--yes` decided anything) whether to start from
 * a preset or choose each part, then walks the slots in order. Flags skip their prompt but are
 * validated against the answers so far; a slot with a single available option is chosen silently. A
 * preset fills every slot no flag set, without prompting, with its value where the flags allow it
 * and the default where they don't. `GoBack` returns to the previous slot that was actually
 * prompted, and from the first one to the preset prompt.
 */
export const askStack = (
  flags: StackFlags,
  io: PromptIOShape,
  opts: AskOptions = {},
): Effect.Effect<
  StackConfig,
  PromptError | IncompatibleStack | InvalidProjectName | UnknownPreset
> =>
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

    // 2. a preset, from the flag or the prompt
    let preset: Preset | undefined
    if (flags.preset !== undefined) {
      preset = presetById(flags.preset)
      if (preset === undefined)
        return yield* new UnknownPreset({
          value: flags.preset,
          allowed: presets.map((p) => p.id),
        })
    }
    const slotFlags = slots.some((s) => flags[s.id as keyof StackFlags] !== undefined)
    const askPreset = preset === undefined && opts.yes !== true && !slotFlags

    // 3. slots
    const previous: Draft = {}
    let presetAnswer: string | undefined
    for (;;) {
      if (askPreset) {
        const answer = yield* io.select({
          id: "preset",
          message: "Start from a preset, or choose each part?",
          options: presetChoices(),
          initial: presetAnswer ?? (presets[0] as Preset).id,
          canGoBack: false,
        })
        presetAnswer = answer === GoBack ? CUSTOM : answer
        preset = presetById(presetAnswer)
      }
      const draft = yield* walkSlots(flags, io, {
        ...opts,
        preset,
        previous,
        backToStart: askPreset,
      })
      if (draft === GoBack) continue
      if (preset !== undefined) opts.onPreset?.(preset)
      return yield* validate({ name, ...draft } as unknown as StackConfig)
    }
  })

const walkSlots = (
  flags: StackFlags,
  io: PromptIOShape,
  opts: AskOptions & {
    readonly preset: Preset | undefined
    readonly previous: Draft
    readonly backToStart: boolean
  },
): Effect.Effect<Draft | GoBack, PromptError | IncompatibleStack> =>
  Effect.gen(function* () {
    const { preset, previous } = opts
    const draft: Draft = {}
    const history: number[] = []
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
      if (preset !== undefined) {
        // the preset's value where the flags allow it, else the default
        const value = preset.stack[slot.id]
        draft[slot.id] =
          typeof value === "string"
            ? ids.includes(value)
              ? value
              : defaultFor(slot, options)
            : value.filter((v) => ids.includes(v))
        i++
        continue
      }
      if (opts.yes || (!slot.multi && options.length <= 1)) {
        draft[slot.id] = defaultFor(slot, options)
        i++
        continue
      }

      const choices = options.map((o) => ({ value: o.id, label: o.label, hint: o.hint }))
      const canGoBack = history.length > 0 || opts.backToStart
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
        if (back === undefined) return GoBack
        for (let j = back; j < slots.length; j++) delete draft[(slots[j] as { id: SlotId }).id]
        i = back
        continue
      }
      draft[slot.id] = answer
      previous[slot.id] = answer
      history.push(i)
      i++
    }
    return draft
  })
