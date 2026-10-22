import { Command } from "effect/cli"
import { addCommand } from "./commands/add.ts"
import { createCommand, createConfig, createHandler } from "./commands/create.ts"
import { listCommand } from "./commands/list.ts"
import { efforgeVersion } from "./versions.ts"

/** Root behaves as `create`; `efforge create` is an explicit alias, `add` and `list` are separate. */
export const root = Command.make("create-efforge", createConfig, createHandler).pipe(
  Command.withDescription(
    "Scaffold an Effect + TanStack Start app on Cloudflare with database, auth and services already wired together",
  ),
  Command.withSubcommands([createCommand, addCommand, listCommand]),
  Command.withExamples([
    {
      command: "npm create efforge my-app",
      description: "Answer a few questions, then create ./my-app",
    },
    {
      command: "npm create efforge my-app -- --yes --database=d1 --orm=effect-sql",
      description: "No questions: flags, defaults for the rest",
    },
    {
      command: "npm create efforge . -- --yes",
      description: "Create in the current (empty) directory",
    },
    { command: "npx create-efforge list", description: "See every add-on" },
    {
      command: "npx create-efforge add email storage",
      description: "Add add-ons to an existing project",
    },
  ]),
)

export const main = Command.run(root, { version: efforgeVersion })

/** Same command, but with explicit arguments (used by tests). */
export const runWith = Command.runWith(root, { version: efforgeVersion })
