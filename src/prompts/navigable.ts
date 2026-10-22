import { stripVTControlCharacters } from "node:util"
import * as p from "@clack/prompts"
import { Cause, Context, Effect, Layer, Schema } from "effect"
import pc from "picocolors"

/** Returned by a prompt when the user picked "Back". */
export const GoBack: unique symbol = Symbol.for("efforge/GoBack")
export type GoBack = typeof GoBack

export class Cancelled extends Schema.TaggedError<Cancelled>()("Cancelled", {}) {}

/** A prompt was needed but stdin is not a terminal (CI, pipes): fail fast instead of hanging. */
export class NeedsInput extends Schema.TaggedError<NeedsInput>()("NeedsInput", {
  id: Schema.String,
  options: Schema.Array(Schema.String),
}) {}

export type PromptError = Cancelled | NeedsInput

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
  readonly select: (o: SelectOptions) => Effect.Effect<string | GoBack, PromptError>
  readonly multiselect: (
    o: MultiselectOptions,
  ) => Effect.Effect<ReadonlyArray<string> | GoBack, PromptError>
  readonly text: (o: TextOptions) => Effect.Effect<string | GoBack, PromptError>
  readonly confirm: (o: ConfirmOptions) => Effect.Effect<boolean | GoBack, PromptError>
  /** Non-interactive output, kept on the service so tests stay silent. */
  readonly intro: (title: string) => Effect.Effect<void>
  readonly section: (title: string) => Effect.Effect<void>
  readonly info: (message: string) => Effect.Effect<void>
  readonly warn: (message: string) => Effect.Effect<void>
  readonly note: (body: string, title: string) => Effect.Effect<void>
  readonly outro: (message: string) => Effect.Effect<void>
  /** Runs `eff` under a spinner labelled `label`, then reports how long it took. */
  readonly step: <A, E, R>(label: string, eff: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  /** Like `step`, but shows the latest output line (fed through `log`) while it runs. */
  readonly task: <A, E, R>(
    label: string,
    eff: (log: (line: string) => void) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
}

export class PromptIO extends Context.Service<PromptIO, PromptIOShape>()("efforge/PromptIO") {}

const BACK = "\u0000back"
const backChoice: p.Option<string> = { value: BACK, label: pc.dim("← Back") }

const ask = <A>(
  id: string,
  options: ReadonlyArray<string>,
  run: () => Promise<A | symbol>,
): Effect.Effect<A, PromptError> =>
  process.stdin.isTTY
    ? Effect.promise(run).pipe(
        Effect.flatMap((v) =>
          p.isCancel(v) ? Effect.fail(new Cancelled()) : Effect.succeed(v as A),
        ),
      )
    : Effect.fail(new NeedsInput({ id, options }))

const interactive = (): boolean => process.stdout.isTTY && !p.isCI()

/** Elapsed time, shown only once it's worth reading (`always` for installs). */
const seconds = (start: number, always = false): string => {
  const s = (performance.now() - start) / 1000
  return always || s >= 1 ? ` ${pc.dim(`${s.toFixed(1)}s`)}` : ""
}

/** Keeps the streamed lines readable: no colour codes, no carriage-return progress redraws. */
const clean = (line: string): string =>
  stripVTControlCharacters(line.split("\r").pop() ?? "").trimEnd()

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
    ask<string>(
      o.id,
      o.options.map((c) => c.value),
      () =>
        p.select<string>({
          message: o.message,
          options: [...o.options.map(toOption), ...(o.canGoBack ? [backChoice] : [])],
          ...(o.initial === undefined ? {} : { initialValue: o.initial }),
        }),
    ).pipe(Effect.map((v) => (v === BACK ? GoBack : v))),
  multiselect: (o) =>
    ask<string[]>(
      o.id,
      o.options.map((c) => c.value),
      () =>
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
    ask<string>(o.id, [], () =>
      p.text({
        message: o.message,
        ...(o.placeholder === undefined ? {} : { placeholder: o.placeholder }),
        ...(o.defaultValue === undefined ? {} : { defaultValue: o.defaultValue }),
        ...(o.validate === undefined
          ? {}
          : {
              // an emptied field submits "" (not undefined) after an error; both mean the default
              validate: (v: string | undefined) =>
                o.validate?.(v === undefined || v === "" ? (o.defaultValue ?? "") : v),
            }),
      }),
    ),
  confirm: (o) =>
    ask<boolean>(o.id, [], () =>
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
  warn: (message) => Effect.sync(() => p.log.warn(message)),
  // Spinners and live logs redraw the terminal: in CI or a pipe, print one line per step instead.
  step: (label, eff) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const start = performance.now()
        if (!interactive()) return { start, s: undefined }
        const s = p.spinner()
        s.start(label)
        return { start, s }
      }),
      () => eff,
      ({ start, s }, exit) =>
        Effect.sync(() => {
          const ok = exit._tag === "Success"
          const interrupted = !ok && Cause.hasInterruptsOnly(exit.cause)
          const msg = ok
            ? `${pc.green("✓")} ${label}${seconds(start)}`
            : interrupted
              ? `${label} ${pc.dim("(cancelled)")}`
              : `${label} failed`
          if (s === undefined) (ok ? p.log.message : p.log.error)(msg)
          else if (ok) s.stop(msg)
          else if (interrupted) s.cancel(msg)
          else s.error(msg)
        }),
    ),
  task: (label, eff) =>
    Effect.suspend(() => {
      const start = performance.now()
      if (!interactive()) {
        p.log.message(`${label}…`)
        return eff(() => {}).pipe(
          Effect.tap(() =>
            Effect.sync(() => p.log.message(`${pc.green("✓")} ${label}${seconds(start, true)}`)),
          ),
        )
      }
      // One line that updates in place: the spinner shows the latest output line, cut to fit.
      // (clack's taskLog miscounts wrapped lines when clearing and erases output above it.)
      const s = p.spinner()
      s.start(label)
      const room = Math.max(20, (process.stdout.columns || 80) - label.length - 12)
      return eff((line) => {
        const text = clean(line)
        if (text !== "")
          s.message(
            `${label}  ${pc.dim(text.length > room ? `${text.slice(0, room - 1)}…` : text)}`,
          )
      }).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() =>
            exit._tag === "Success"
              ? s.stop(`${pc.green("✓")} ${label}${seconds(start, true)}`)
              : Cause.hasInterruptsOnly(exit.cause)
                ? s.cancel(`${label} ${pc.dim("(cancelled)")}`)
                : s.error(`${label} failed`),
          ),
        ),
      )
    }),
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
  const take = (s: Shown): Effect.Effect<Answer, PromptError> => {
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
      }) as Effect.Effect<string | GoBack, PromptError>,
    multiselect: (o) =>
      take({
        kind: "multiselect",
        id: o.id,
        options: o.options.map((c) => c.value),
        canGoBack: o.canGoBack,
      }) as Effect.Effect<ReadonlyArray<string> | GoBack, PromptError>,
    // like the live prompt, an answer that fails `validate` is reported and asked again
    text: (o) => {
      const loop: Effect.Effect<string | GoBack, PromptError> = Effect.suspend(
        () =>
          take({ kind: "text", id: o.id, options: [], canGoBack: false }) as Effect.Effect<
            string | GoBack,
            PromptError
          >,
      ).pipe(
        Effect.flatMap((a) => {
          const error = typeof a === "string" ? o.validate?.(a) : undefined
          if (error === undefined) return Effect.succeed(a)
          output.push(`invalid ${o.id}: ${error}`)
          return loop
        }),
      )
      return loop
    },
    confirm: (o) =>
      take({ kind: "confirm", id: o.id, options: [], canGoBack: false }) as Effect.Effect<
        boolean | GoBack,
        PromptError
      >,
    intro: (t) => Effect.sync(() => void output.push(`intro: ${t}`)),
    section: (t) => Effect.sync(() => void output.push(`section: ${t}`)),
    info: (m) => Effect.sync(() => void output.push(`info: ${m}`)),
    warn: (m) => Effect.sync(() => void output.push(`warn: ${m}`)),
    note: (b, t) => Effect.sync(() => void output.push(`note ${t}: ${b}`)),
    outro: (m) => Effect.sync(() => void output.push(`outro: ${m}`)),
    step: (label, eff) =>
      Effect.sync(() => void output.push(`step: ${label}`)).pipe(Effect.andThen(eff)),
    task: (label, eff) =>
      Effect.sync(() => void output.push(`step: ${label}`)).pipe(Effect.andThen(eff(() => {}))),
  }
  return { layer: Layer.succeed(PromptIO, io), shown, output }
}
