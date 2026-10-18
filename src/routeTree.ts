import type { Effect } from "effect"
import type { ChildProcessSpawner } from "effect/process"
import { type CommandFailed, exec } from "./exec.ts"

/** Generated projects don't commit `routeTree.gen.ts`; this writes it (TanStack Router's generator). */
export const ROUTE_TREE_ARGS: ReadonlyArray<string> = ["--filter", "web", "exec", "tsr", "generate"]

/** The same command as one shell string, for scripts and the e2e helper. */
export const ROUTE_TREE_COMMAND = ["pnpm", ...ROUTE_TREE_ARGS].join(" ")

/** Runs after `pnpm install` (the generator is a dev dependency) and before the first format. */
export const generateRouteTree = (
  dir: string,
): Effect.Effect<string, CommandFailed, ChildProcessSpawner.ChildProcessSpawner> =>
  exec("pnpm", [...ROUTE_TREE_ARGS], dir)
