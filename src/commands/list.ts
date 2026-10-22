import { Console, Effect, Path } from "effect"
import { Command, Flag } from "effect/cli"
import pc from "picocolors"
import { loadAddons } from "../addon.ts"
import { slots } from "../slots.ts"
import { readManifest } from "./add.ts"
import { TemplatesDir } from "./create.ts"

export interface ListedAddon {
  readonly id: string
  readonly slot: string
  readonly option: string
  readonly title: string
  readonly description: string
  /** Part of the project in `--cwd` (only when it is an efforge project). */
  readonly installed?: boolean
}

/** Every option of every slot, with its add-on description; `none` and single-option slots are left out. */
export const listAddons = (cwd: string) =>
  Effect.gen(function* () {
    const addons = yield* loadAddons(yield* TemplatesDir)
    // outside a project, list everything; a --cwd that doesn't exist is a mistake worth reporting
    const stack = yield* readManifest(cwd).pipe(
      Effect.map((m) => m.stack),
      Effect.catchTag("NotAnEfforgeProject", (e) =>
        e.reason === "efforge.jsonc not found" ? Effect.succeed(undefined) : Effect.fail(e),
      ),
    )
    const out: ListedAddon[] = []
    for (const slot of slots) {
      if (slot.options.length <= 1) continue
      for (const o of slot.options) {
        if (o.id === "none") continue
        const id = `${slot.id}/${o.id}`
        const m = addons.get(id)?.manifest
        const installed =
          stack === undefined
            ? undefined
            : slot.id === "extras"
              ? stack.extras.includes(o.id as never)
              : stack[slot.id] === o.id
        out.push({
          id,
          slot: slot.id,
          option: o.id,
          title: m?.title ?? o.label,
          description: m?.description ?? o.hint ?? "",
          ...(installed === undefined ? {} : { installed }),
        })
      }
    }
    return { project: stack !== undefined, addons: out }
  })

/** First clause of a description, cut to fit the terminal. */
const short = (s: string, room: number) => {
  const clause = s.split(/[:;]\s|\.(?:\s|$)/)[0] ?? s
  return clause.length <= room ? clause : `${clause.slice(0, Math.max(10, room - 1)).trimEnd()}…`
}

export const listCommand = Command.make(
  "list",
  {
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print the add-ons as JSON on stdout"),
      Flag.withDefault(false),
    ),
    cwd: Flag.String("cwd").pipe(
      Flag.withDescription(
        "Mark what this efforge project already has (default: current directory)",
      ),
      Flag.withDefault("."),
    ),
  },
  (input) =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const { project, addons } = yield* listAddons(path.resolve(input.cwd))
      if (input.json) return yield* Console.log(JSON.stringify(addons, null, 2))
      const width = Math.max(...addons.map((a) => a.id.length))
      // cut descriptions to the terminal; piped output keeps them whole, a very narrow one drops them
      const room = process.stdout.isTTY ? (process.stdout.columns || 80) - width - 6 : undefined
      const lines: string[] = []
      let slot = ""
      for (const a of addons) {
        if (a.slot !== slot) {
          slot = a.slot
          const def = slots.find((s) => s.id === slot)
          lines.push("", pc.bold(def?.title ?? slot))
        }
        const mark = a.installed === true ? pc.green("✓") : " "
        if (room !== undefined && room < 20) {
          lines.push(`${mark} ${a.installed === true ? pc.dim(a.id) : pc.cyan(a.id)}`)
          continue
        }
        lines.push(
          `${mark} ${a.installed === true ? pc.dim(a.id.padEnd(width)) : pc.cyan(a.id.padEnd(width))}  ${pc.dim(room === undefined ? a.description : short(a.description, room))}`,
        )
      }
      lines.push(
        "",
        pc.dim(
          project
            ? "✓ already in this project. Add one with: npx create-efforge add <id>"
            : "Pick them in npm create efforge, or add one later with: npx create-efforge add <id>",
        ),
      )
      yield* Console.log(lines.join("\n").replace(/^\n/, ""))
    }).pipe(
      Effect.catch((e) =>
        Effect.gen(function* () {
          const err = e as { readonly _tag: string; readonly message?: string }
          yield* Console.error(pc.red(err.message ?? err._tag))
          yield* Effect.sync(() => {
            process.exitCode = 1
          })
        }),
      ),
    ),
).pipe(Command.withDescription("List the add-ons you can pick or add later"))
