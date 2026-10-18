// Throwaway spike: how does an Effect CLI + clack "create" flow feel?
// Every stack part is a slot with replaceable options; nothing is generated
// except an efforge.json manifest and a preview of the files an add-on would write.
import * as p from "@clack/prompts"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { mkdir, writeFile } from "node:fs/promises"
import pc from "picocolors"

type Opt = {
  id: string
  label: string
  hint?: string
  needs?: Partial<Record<SlotId, string[]>> // only offered when another slot matches
  files?: string[]
}
type Slot = { id: SlotId; title: string; multi?: boolean; default: string | string[]; options: Opt[] }
type SlotId = "runtime" | "database" | "auth" | "infra" | "ai" | "extras"

const slots: Slot[] = [
  {
    id: "runtime", title: "Where does it run?", default: "cloudflare",
    options: [
      { id: "cloudflare", label: "Cloudflare Workers", hint: "TanStack Start on Workers", files: ["wrangler.jsonc"] },
      { id: "node", label: "Node", hint: "TanStack Start + Docker image", files: ["Dockerfile"] },
    ],
  },
  {
    id: "database", title: "Database", default: "postgres",
    options: [
      { id: "postgres", label: "Postgres (any URL)", hint: "@effect/sql-pg, bring DATABASE_URL", files: ["packages/db/"] },
      { id: "neon", label: "Neon", hint: "Postgres + branch per PR", files: ["packages/db/"] },
      { id: "supabase", label: "Supabase Postgres", files: ["packages/db/"] },
      { id: "d1", label: "Cloudflare D1", hint: "SQLite at the edge", needs: { runtime: ["cloudflare"] }, files: ["packages/db/"] },
      { id: "sqlite", label: "SQLite file", needs: { runtime: ["node"] }, files: ["packages/db/"] },
      { id: "none", label: "None" },
    ],
  },
  {
    id: "auth", title: "Auth", default: "better-auth-orgs",
    options: [
      { id: "better-auth-orgs", label: "better-auth + organizations", hint: "workspaces, invites, roles", needs: { database: ["postgres", "neon", "supabase", "d1", "sqlite"] }, files: ["apps/web/src/auth/"] },
      { id: "better-auth", label: "better-auth (users only)", needs: { database: ["postgres", "neon", "supabase", "d1", "sqlite"] }, files: ["apps/web/src/auth/"] },
      { id: "none", label: "None" },
    ],
  },
  {
    id: "infra", title: "Infrastructure as code", default: "none",
    options: [
      { id: "none", label: "None", hint: "plain config files, deploy however you like" },
      { id: "alchemy", label: "Alchemy", hint: "infra/alchemy.run.ts, preview stage per PR", files: ["infra/alchemy.run.ts"] },
    ],
  },
  {
    id: "ai", title: "AI", default: "none",
    options: [
      { id: "none", label: "None" },
      { id: "effect-ai-byok", label: "@effect/ai, bring your own key", hint: "Anthropic, OpenAI, OpenRouter, Ollama", files: ["packages/llm/"] },
    ],
  },
  {
    id: "extras", title: "Extras", multi: true, default: [],
    options: [
      { id: "workflows", label: "Background jobs", hint: "Cloudflare Workflows", needs: { runtime: ["cloudflare"] }, files: ["apps/web/src/workflows/"] },
      { id: "realtime", label: "Realtime", hint: "Durable Object + WebSocket", needs: { runtime: ["cloudflare"] }, files: ["apps/web/src/rooms/"] },
      { id: "browser", label: "Headless browser", hint: "Playwright in a Container", needs: { runtime: ["cloudflare"] }, files: ["apps/browser/"] },
      { id: "storage", label: "File storage", hint: "R2 / S3-compatible", files: ["packages/storage/"] },
      { id: "email", label: "Email", files: ["packages/email/"] },
    ],
  },
]

type Choices = Record<SlotId, string | string[]>

const available = (slot: Slot, c: Partial<Choices>) =>
  slot.options.filter((o) =>
    Object.entries(o.needs ?? {}).every(([k, ok]) => {
      const v = c[k as SlotId]
      return v === undefined || ok!.includes(v as string)
    }),
  )

const cancelled = (v: unknown) => {
  if (p.isCancel(v)) {
    p.cancel("Cancelled.")
    process.exit(0)
  }
  return v
}

const flags = Object.fromEntries(
  slots.map((s) => [
    s.id,
    Flag.String(s.id).pipe(Flag.withDescription(`${s.title} (${s.options.map((o) => o.id).join(" | ")})`), Flag.optional),
  ]),
) as Record<SlotId, Flag.Flag<Option.Option<string>>>

const create = Command.make(
  "create-efforge",
  {
    name: Argument.String("name").pipe(Argument.withDescription("Project directory"), Argument.optional),
    yes: Flag.Boolean("yes").pipe(Flag.withAlias("y"), Flag.withDescription("Accept defaults for anything not set by a flag"), Flag.withDefault(false)),
    ...flags,
  },
  Effect.fn(function* (input) {
    console.clear()
    p.intro(pc.bgCyan(pc.black(" create-efforge ")) + pc.dim("  opinionated, every part replaceable"))

    const name = Option.isSome(input.name)
      ? input.name.value
      : (cancelled(yield* Effect.promise(() => p.text({ message: "Project name", placeholder: "my-app", defaultValue: "my-app" }))) as string)

    const c: Partial<Choices> = {}
    for (const slot of slots) {
      const opts = available(slot, c)
      const flag = (input as unknown as Record<string, Option.Option<string>>)[slot.id]!
      if (Option.isSome(flag)) {
        const v = slot.multi ? flag.value.split(",").filter(Boolean) : flag.value
        const bad = [v].flat().filter((x) => !opts.some((o) => o.id === x))
        if (bad.length) {
          p.cancel(`--${slot.id}=${bad.join(",")} isn't available here. Options: ${opts.map((o) => o.id).join(", ")}`)
          process.exit(1)
        }
        c[slot.id] = v
        p.log.step(`${slot.title} ${pc.dim("→")} ${pc.cyan([v].flat().join(", ") || "none")} ${pc.dim("(flag)")}`)
        continue
      }
      if (input.yes) {
        const def = slot.multi ? [] : opts.some((o) => o.id === slot.default) ? slot.default : opts[0]!.id
        c[slot.id] = def
        p.log.step(`${slot.title} ${pc.dim("→")} ${pc.cyan([def].flat().join(", ") || "none")} ${pc.dim("(default)")}`)
        continue
      }
      const toItem = (o: Opt) => ({ value: o.id, label: o.label, hint: o.hint })
      c[slot.id] = slot.multi
        ? (cancelled(yield* Effect.promise(() => p.multiselect({ message: slot.title, options: opts.map(toItem), required: false }))) as string[])
        : (cancelled(yield* Effect.promise(() => p.select({ message: slot.title, options: opts.map(toItem), initialValue: opts.some((o) => o.id === slot.default) ? slot.default : opts[0]!.id }))) as string)
    }

    const picked = slots.flatMap((s) => [c[s.id]!].flat().map((id) => s.options.find((o) => o.id === id)!))
    const files = ["apps/web/", "package.json", "turbo.json", "biome.json", ...picked.flatMap((o) => o.files ?? [])]

    p.note(
      slots.map((s) => `${pc.dim(s.id.padEnd(9))} ${[c[s.id]!].flat().join(", ") || "none"}`).join("\n") +
        "\n\n" + pc.dim("re-run non-interactively:\n") +
        `npm create efforge ${name} ${slots.map((s) => `--${s.id}=${[c[s.id]!].flat().join(",") || "none"}`).filter((f) => !f.endsWith("=none") && !f.endsWith("=")).join(" ")}`,
      "Your stack",
    )

    if (!input.yes) {
      const ok = cancelled(yield* Effect.promise(() => p.confirm({ message: "Create it?" })))
      if (!ok) return p.outro("Nothing written.")
    }

    const s = p.spinner()
    const steps = ["Copying base template", ...picked.filter((o) => o.files).map((o) => `Adding ${o.label}`), "Wiring Effect layers", "Installing dependencies"]
    for (const step of steps) {
      s.start(step)
      yield* Effect.sleep("350 millis")
      s.stop(`${pc.green("✓")} ${step}`)
    }

    const dir = `out/${name}`
    yield* Effect.promise(async () => {
      await mkdir(dir, { recursive: true })
      await writeFile(`${dir}/efforge.json`, JSON.stringify({ name, stack: c, files }, null, 2) + "\n")
    })

    p.outro(`${pc.green("Done.")} ${pc.dim(`(spike: only ${dir}/efforge.json was written)`)}\n\n  cd ${name}\n  pnpm dev`)
  }),
).pipe(Command.withDescription("Create a new app on the Ovriq stack"))

create.pipe(Command.run({ version: "0.0.0-spike" }), Effect.provide(NodeServices.layer), NodeRuntime.runMain)
