import { tmpdir } from "node:os"
import { Effect, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

export class CommandFailed extends Schema.TaggedError<CommandFailed>()("CommandFailed", {
  command: Schema.String,
  exitCode: Schema.optionalKey(Schema.Number),
  output: Schema.String,
}) {}

/**
 * The one install efforge runs and tells people to run. `add` changes dependencies, so the
 * lockfile must be rewritten; with `CI` set (CI, and many agent sandboxes) pnpm installs with a
 * frozen lockfile by default and fails with OUTDATED_LOCKFILE.
 */
export const INSTALL_ARGS = ["install", "--no-frozen-lockfile"] as const
export const INSTALL = `pnpm ${INSTALL_ARGS.join(" ")}`

/** The steps after the install that finish a create, as `create` runs them. */
export const FORMAT = "pnpm format"
export const COMMIT = "git add -A && git commit -m 'Initial commit'"

/**
 * Runs `cmd args` in `cwd`, returning combined output; a non-zero exit fails with `CommandFailed`.
 * `onLine` sees each output line as it arrives (for live progress).
 */
export const exec = (
  cmd: string,
  args: ReadonlyArray<string>,
  cwd: string,
  onLine?: (line: string) => void,
): Effect.Effect<string, CommandFailed, ChildProcessSpawner.ChildProcessSpawner> => {
  const command = [cmd, ...args].join(" ")
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const handle = yield* spawner.spawn(ChildProcess.make(cmd, [...args], { cwd }))
    const lines: string[] = []
    const [, code] = yield* Effect.all(
      [
        handle.all.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runForEach((line) =>
            Effect.sync(() => {
              lines.push(line)
              onLine?.(line)
            }),
          ),
        ),
        handle.exitCode,
      ],
      { concurrency: 2 },
    )
    const output = lines.join("\n")
    if (code !== 0) return yield* new CommandFailed({ command, exitCode: code, output })
    return output
  }).pipe(
    Effect.scoped,
    Effect.catchTag("PlatformError", (e) => new CommandFailed({ command, output: e.message })),
  )
}

/**
 * True when `cmd --version` runs; used to check for pnpm and git before writing anything.
 * Runs in the OS temp dir, not the project: in a directory whose package.json names a
 * `packageManager`, pnpm 12 writes a pnpm-lock.yaml even for `--version`.
 */
export const has = (cmd: string) =>
  exec(cmd, ["--version"], tmpdir()).pipe(
    Effect.as(true),
    Effect.catchTag("CommandFailed", () => Effect.succeed(false)),
  )
