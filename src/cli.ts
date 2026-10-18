import { Command } from "effect/cli"
import { addCommand } from "./commands/add.ts"
import { createCommand, createConfig, createHandler } from "./commands/create.ts"
import { efforgeVersion } from "./versions.ts"

/** Root behaves as `create`; `efforge create` is an explicit alias, `efforge add` is separate. */
export const root = Command.make("create-efforge", createConfig, createHandler).pipe(
  Command.withDescription(
    "Scaffold an Effect + TanStack Start app on Cloudflare with database, auth and services already wired together",
  ),
  Command.withSubcommands([createCommand, addCommand]),
)

export const main = Command.run(root, { version: efforgeVersion })

/** Same command, but with explicit arguments (used by tests). */
export const runWith = Command.runWith(root, { version: efforgeVersion })
