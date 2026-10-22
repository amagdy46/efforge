import { Effect, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

export class CommandFailed extends Schema.TaggedError<CommandFailed>()("CommandFailed", {
  command: Schema.String,
  exitCode: Schema.optionalKey(Schema.Number),
  output: Schema.String,
}) {}

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

/** True when `cmd --version` runs; used to check for pnpm and git before writing anything. */
export const has = (cmd: string, cwd: string) =>
  exec(cmd, ["--version"], cwd).pipe(
    Effect.as(true),
    Effect.catchTag("CommandFailed", () => Effect.succeed(false)),
  )
