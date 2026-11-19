import { Effect, Exit, Schema } from "effect"
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
  /** Told, for each of the preset's choices a flag left no room for, what was dropped and why. */
  readonly onDropped?: ((message: string) => void) | undefined
  /**
   * Walk every part again with these as the defaults ("Change parts" after a preset): the stack
   * shown, and the preset it came from.
   */
  readonly seed?: { readonly stack: StackConfig; readonly preset: Preset | undefined } | undefined
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

/** The choices of the preset prompt: each preset with what it holds, then "choose each part". */
export const presetChoices = () => {
  const all = [
    ...presets.map((p) => ({ value: p.id, title: p.title, about: p.description })),
    { value: CUSTOM, title: "Choose each part", about: "database, ORM, auth, infra, AI, extras" },
  ]
  const width = Math.max(...all.map((c) => c.title.length))
  return all.map((c) => ({ value: c.value, label: `${c.title.padEnd(width)}  ${c.about}` }))
}

/** The slot whose value decides whether `value` is available for `slot`, if one does. */
const decidedBy = (slot: SlotId, value: string): SlotId | undefined =>
  whyUnavailable(slot, value, { runtime: "other" } as unknown as Partial<StackConfig>) !== undefined
    ? "runtime"
    : slot === "orm" || slot === "auth"
      ? "database"
      : undefined

/**
 * A preset's stack with the slot flags on top. A flag always wins and is never dropped. A choice
 * of the preset that can't stand next to a flag is dropped (its slot becomes none, or it leaves the
 * extras), and `dropped` says so. When flags conflict with each other, or a flag needs something
 * neither it nor another flag gives (auth needs a database, a database needs an ORM), it is
 * `IncompatibleStack`, as without a preset.
 */
export const presetWithFlags = (
  preset: Preset,
  flags: StackFlags,
): Effect.Effect<{ draft: Draft; dropped: string[] }, IncompatibleStack> =>
  Effect.gen(function* () {
    const explicit = new Set<SlotId>(
      slots.filter((x) => flags[x.id as keyof StackFlags] !== undefined).map((x) => x.id),
    )
    const draft: Draft = {}
    for (const x of slots) {
      const flag = flags[x.id as keyof StackFlags]
      draft[x.id] =
        flag === undefined
          ? preset.stack[x.id]
          : typeof flag === "string"
            ? flag
            : [...new Set(flag)]
    }
    const dropped: string[] = []
    const flagOf = (slot: SlotId) => `--${slot}=${String(draft[slot])}`
    for (;;) {
      const exit = Effect.runSyncExit(validate({ name: "app", ...draft } as unknown as StackConfig))
      if (Exit.isSuccess(exit)) return { draft, dropped }
      const e = exit.cause.reasons.find((r) => r._tag === "Fail")?.error as IncompatibleStack
      const slot = e.slot
      const why = whyUnavailable(slot, e.value, draft) ?? "it doesn't fit"
      const by = decidedBy(slot, e.value)
      if (!explicit.has(slot)) {
        const cause = by === undefined ? "your flags" : flagOf(by)
        if (slot === "extras") {
          draft.extras = (draft.extras as ReadonlyArray<string>).filter((x) => x !== e.value)
          dropped.push(`${cause} drops the ${preset.id} preset's ${e.value} extra: ${why}.`)
          continue
        }
        if (e.value !== "none" && e.allowed.includes("none")) {
          draft[slot] = "none"
          dropped.push(`${cause} drops the ${preset.id} preset's ${slot}=${e.value}: ${why}.`)
          continue
        }
        // the preset can give way only by leaving a part out: the flag needs one no flag gives
        if (by !== undefined && explicit.has(by)) {
          const allowed =
            slots
              .find((x) => x.id === by)
              ?.options.map((o) => o.id)
              .filter((id) => id !== draft[by]) ?? []
          return yield* new IncompatibleStack({
            slot: by,
            value: String(draft[by]),
            allowed,
            reason: `${why.split(";")[0] ?? why}, and the ${preset.id} preset's ${slot} is ${e.value}`,
          })
        }
        return yield* e
      }
      // a flag that can't stand: against another flag, or against the preset's choice
      const reason =
        by !== undefined && !explicit.has(by) ? `${why} (the ${preset.id} preset's ${by})` : why
      return yield* new IncompatibleStack({ slot, value: e.value, allowed: e.allowed, reason })
    }
  })

/**
 * The fewest flags that make `stack` from `preset`: the preset, then the parts that differ from it,
 * less those the others already imply (`--database=none` leaves no ORM).
 */
export const presetFlags = (preset: Preset, stack: StackConfig): string => {
  const differ: StackFlags = {}
  for (const x of slots) {
    const want = x.id === "extras" ? stack.extras.join(",") : stack[x.id]
    const has = x.id === "extras" ? preset.stack.extras.join(",") : preset.stack[x.id]
    if (want !== has)
      Object.assign(differ, { [x.id]: x.id === "extras" ? [...stack.extras] : want })
  }
  const makes = (flags: StackFlags) => {
    const exit = Effect.runSyncExit(presetWithFlags(preset, flags))
    return (
      Exit.isSuccess(exit) &&
      slots.every((x) => JSON.stringify(exit.value.draft[x.id]) === JSON.stringify(stack[x.id]))
    )
  }
  const flags: Record<string, unknown> = { ...differ }
  for (const id of Object.keys(differ).toReversed()) {
    const { [id]: _, ...rest } = flags
    if (makes(rest)) delete flags[id]
  }
  return [
    `--preset=${preset.id}`,
    ...Object.entries(flags).map(
      ([id, v]) => `--${id}=${Array.isArray(v) ? v.join(",") : String(v)}`,
    ),
  ].join(" ")
}

/** `stack` is exactly what `preset` chooses. */
export const isPreset = (preset: Preset, stack: StackConfig): boolean =>
  presetFlags(preset, stack) === `--preset=${preset.id}`

/**
 * Asks for the name, then (when no stack flag and no `--yes` decided anything) whether to start from
 * a preset or choose each part, then walks the slots in order. Flags skip their prompt but are
 * validated against the answers so far; a slot with a single available option is chosen silently. A
 * preset (from the flag or the prompt) fills every slot no flag set, without prompting, by the rule
 * of `presetWithFlags`. `GoBack` returns to the previous slot that was actually prompted, and from
 * the first one to the preset prompt. With `seed`, it walks every slot with the seed's values as
 * the defaults.
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
    const seed = opts.seed
    if (preset !== undefined && seed === undefined) {
      const { draft, dropped } = yield* presetWithFlags(preset, flags)
      for (const m of dropped) opts.onDropped?.(m)
      opts.onPreset?.(preset)
      return yield* validate({ name, ...draft } as unknown as StackConfig)
    }
    const slotFlags = slots.some((s) => flags[s.id as keyof StackFlags] !== undefined)
    const askPreset = flags.preset === undefined && opts.yes !== true && !slotFlags

    // 3. slots: after "Change parts", every one again, with the stack shown as the defaults
    const previous: Draft = seed === undefined ? {} : { ...seed.stack }
    let presetAnswer: string | undefined = seed?.preset?.id
    let first = true
    for (;;) {
      const fromSeed = first && seed !== undefined
      first = false
      if (askPreset && !fromSeed) {
        const answer = yield* io.select({
          id: "preset",
          message: "Start from a preset, or choose each part?",
          options: presetChoices(),
          initial: presetAnswer ?? (presets[0] as Preset).id,
          canGoBack: false,
        })
        presetAnswer = answer === GoBack ? CUSTOM : answer
        preset = presetById(presetAnswer)
        if (preset !== undefined) {
          opts.onPreset?.(preset)
          return yield* validate({ name, ...preset.stack })
        }
      }
      const draft = yield* walkSlots(flags, io, {
        ...opts,
        previous,
        backToStart: askPreset,
      })
      if (draft === GoBack) continue
      if (fromSeed && seed?.preset !== undefined) opts.onPreset?.(seed.preset)
      else if (preset !== undefined) opts.onPreset?.(preset)
      return yield* validate({ name, ...draft } as unknown as StackConfig)
    }
  })

const walkSlots = (
  flags: StackFlags,
  io: PromptIOShape,
  opts: AskOptions & {
    readonly previous: Draft
    readonly backToStart: boolean
  },
): Effect.Effect<Draft | GoBack, PromptError | IncompatibleStack> =>
  Effect.gen(function* () {
    const { previous } = opts
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
      if (opts.yes || (!slot.multi && options.length <= 1)) {
        draft[slot.id] = defaultFor(slot, options)
        i++
        continue
      }

      const choices = options.map((o) => ({ value: o.id, label: o.label, hint: o.hint }))
      const canGoBack = history.length > 0 || opts.backToStart
      // an earlier answer, else (after "Change parts") the part shown, where it is still offered
      const before = previous[slot.id]
      const prev = slot.multi
        ? (before as ReadonlyArray<string> | undefined)?.filter((v) => ids.includes(v))
        : typeof before === "string" && ids.includes(before)
          ? before
          : undefined
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
