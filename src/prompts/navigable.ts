import * as p from "@clack/prompts"
import { Context, Effect, Layer, Schema } from "effect"
import pc from "picocolors"

/** Returned by a prompt when the user picked "Back". */
export const GoBack: unique symbol = Symbol.for("efforge/GoBack")
export type GoBack = typeof GoBack

export class Cancelled extends Schema.TaggedError<Cancelled>()("Cancelled", {}) {}

export interface Choice {
  readonly value: string
  readonly label: string
  readonly hint?: string | undefined
}

/** `id` names the prompt (a slot id, or "name"/"confirm"); the live layer ignores it, the scripted layer records it. */
export interface SelectOptions {
  readonly id: string
  readonly message: string
  readonly options: ReadonlyArray<Choice>
  readonly initial?: string | undefined
  readonly canGoBack: boolean
}
export interface MultiselectOptions {
  readonly id: string
  readonly message: string
  readonly options: ReadonlyArray<Choice>
  readonly initial?: ReadonlyArray<string> | undefined
  readonly canGoBack: boolean
}
export interface TextOptions {
  readonly id: string
  readonly message: string
  readonly placeholder?: string | undefined
  readonly defaultValue?: string | undefined
  readonly validate?: ((value: string) => string | undefined) | undefined
}
export interface ConfirmOptions {
  readonly id: string
  readonly message: string
  readonly initial?: boolean | undefined
}

export interface PromptIOShape {
  readonly select: (o: SelectOptions) => Effect.Effect<string | GoBack, Cancelled>
  readonly multiselect: (
    o: MultiselectOptions,
  ) => Effect.Effect<ReadonlyArray<string> | GoBack, Cancelled>
  readonly text: (o: TextOptions) => Effect.Effect<string | GoBack, Cancelled>
  readonly confirm: (o: ConfirmOptions) => Effect.Effect<boolean | GoBack, Cancelled>
  /** Non-interactive output, kept on the service so tests stay silent. */
  readonly intro: (title: string) => Effect.Effect<void>
  readonly section: (title: string) => Effect.Effect<void>
  readonly info: (message: string) => Effect.Effect<void>
  readonly note: (body: string, title: string) => Effect.Effect<void>
  readonly outro: (message: string) => Effect.Effect<void>
  /** Runs `eff` under a spinner labelled `label`. */
  readonly step: <A, E, R>(label: string, eff: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

export class PromptIO extends Context.Service<PromptIO, PromptIOShape>()("efforge/PromptIO") {}

const BACK = "\u0000back"
const backChoice: p.Option<string> = { value: BACK, label: pc.dim("← Back") }

const ask = <A>(run: () => Promise<A | symbol>): Effect.Effect<A, Cancelled> =>
  Effect.promise(run).pipe(
    Effect.flatMap((v) => (p.isCancel(v) ? Effect.fail(new Cancelled()) : Effect.succeed(v as A))),
  )

const toOption = (c: Choice) =>
  (c.hint === undefined
    ? { value: c.value, label: c.label }
    : { value: c.value, label: c.label, hint: c.hint }) as p.Option<string>

/**
 * clack 1.8.1 has no back/escape signal, so "go back" is a synthetic "← Back"
 * entry: last in a select, and in a multiselect (picking it alone goes back).
 */
export const livePromptIO: PromptIOShape = {
  select: (o) =>
    ask<string>(() =>
      p.select<string>({
        message: o.message,
        options: [...o.options.map(toOption), ...(o.canGoBack ? [backChoice] : [])],
        ...(o.initial === undefined ? {} : { initialValue: o.initial }),
      }),
    ).pipe(Effect.map((v) => (v === BACK ? GoBack : v))),
  multiselect: (o) =>
    ask<string[]>(() =>
      p.multiselect<string>({
        message: o.canGoBack
          ? `${o.message} ${pc.dim("(select Back alone to go back)")}`
          : o.message,
        options: [...o.options.map(toOption), ...(o.canGoBack ? [backChoice] : [])],
        initialValues: [...(o.initial ?? [])],
        required: false,
      }),
    ).pipe(
      Effect.map((v) =>
        v.includes(BACK) && v.length === 1 ? GoBack : v.filter((x) => x !== BACK),
      ),
    ),
  text: (o) =>
    ask<string>(() =>
      p.text({
        message: o.message,
        ...(o.placeholder === undefined ? {} : { placeholder: o.placeholder }),
        ...(o.defaultValue === undefined ? {} : { defaultValue: o.defaultValue }),
        ...(o.validate === undefined
          ? {}
          : { validate: (v: string | undefined) => o.validate?.(v ?? o.defaultValue ?? "") }),
      }),
    ),
  confirm: (o) =>
    ask<boolean>(() =>
      p.confirm({
        message: o.message,
        ...(o.initial === undefined ? {} : { initialValue: o.initial }),
      }),
    ),
  intro: (title) => Effect.sync(() => p.intro(title)),
  section: (title) => Effect.sync(() => p.log.step(pc.bold(title))),
  info: (message) => Effect.sync(() => p.log.info(message)),
  note: (body, title) => Effect.sync(() => p.note(body, title)),
  outro: (message) => Effect.sync(() => p.outro(message)),
  step: (label, eff) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const s = p.spinner()
        s.start(label)
        return s
      }),
      () => eff,
      (s, exit) =>
        Effect.sync(() =>
          exit._tag === "Success"
            ? s.stop(`${pc.green("✓")} ${label}`)
            : s.error(`${label} failed`),
        ),
    ),
}

export const PromptIOLive: Layer.Layer<PromptIO> = Layer.succeed(PromptIO, livePromptIO)

// --- scripted layer (tests) ---------------------------------------------------

export const CANCEL: unique symbol = Symbol.for("efforge/Cancel")
export type Answer = string | ReadonlyArray<string> | boolean | GoBack | typeof CANCEL

export interface Shown {
  readonly kind: "select" | "multiselect" | "text" | "confirm"
  readonly id: string
  readonly options: ReadonlyArray<string>
  readonly canGoBack: boolean
}
export interface Scripted {
  readonly layer: Layer.Layer<PromptIO>
  /** Every prompt that was displayed, in order. */
  readonly shown: Shown[]
  /** Section headers, notes and other output, in order. */
  readonly output: string[]
}

/** Answers are consumed in order; running out of answers is a test bug and dies. */
export const scriptedPromptIO = (answers: ReadonlyArray<Answer>): Scripted => {
  const shown: Shown[] = []
  const output: string[] = []
  let next = 0
  const take = (s: Shown): Effect.Effect<Answer, Cancelled> => {
    shown.push(s)
    if (next >= answers.length) return Effect.die(`scripted PromptIO: no answer left for "${s.id}"`)
    const a = answers[next++] as Answer
    return a === CANCEL ? Effect.fail(new Cancelled()) : Effect.succeed(a)
  }
  const io: PromptIOShape = {
    select: (o) =>
      take({
        kind: "select",
        id: o.id,
        options: o.options.map((c) => c.value),
        canGoBack: o.canGoBack,
      }) as Effect.Effect<string | GoBack, Cancelled>,
    multiselect: (o) =>
      take({
        kind: "multiselect",
        id: o.id,
        options: o.options.map((c) => c.value),
        canGoBack: o.canGoBack,
      }) as Effect.Effect<ReadonlyArray<string> | GoBack, Cancelled>,
    text: (o) =>
      take({ kind: "text", id: o.id, options: [], canGoBack: false }) as Effect.Effect<
        string | GoBack,
        Cancelled
      >,
    confirm: (o) =>
      take({ kind: "confirm", id: o.id, options: [], canGoBack: false }) as Effect.Effect<
        boolean | GoBack,
        Cancelled
      >,
    intro: (t) => Effect.sync(() => void output.push(`intro: ${t}`)),
    section: (t) => Effect.sync(() => void output.push(`section: ${t}`)),
    info: (m) => Effect.sync(() => void output.push(`info: ${m}`)),
    note: (b, t) => Effect.sync(() => void output.push(`note ${t}: ${b}`)),
    outro: (m) => Effect.sync(() => void output.push(`outro: ${m}`)),
    step: (label, eff) =>
      Effect.sync(() => void output.push(`step: ${label}`)).pipe(Effect.andThen(eff)),
  }
  return { layer: Layer.succeed(PromptIO, io), shown, output }
}
