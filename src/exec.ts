import { Effect, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

export class CommandFailed extends Schema.TaggedError<CommandFailed>()("CommandFailed", {
  command: Schema.String,
  exitCode: Schema.optionalKey(Schema.Number),
  output: Schema.String,
}) {}

/** Runs `cmd args` in `cwd`, returning combined output; a non-zero exit fails with `CommandFailed`. */
export const exec = (
  cmd: string,
  args: ReadonlyArray<string>,
  cwd: string,
): Effect.Effect<string, CommandFailed, ChildProcessSpawner.ChildProcessSpawner> => {
  const command = [cmd, ...args].join(" ")
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const handle = yield* spawner.spawn(ChildProcess.make(cmd, [...args], { cwd }))
    const [output, code] = yield* Effect.all(
      [handle.all.pipe(Stream.decodeText(), Stream.mkString), handle.exitCode],
      { concurrency: 2 },
    )
    if (code !== 0) return yield* new CommandFailed({ command, exitCode: code, output })
    return output
  }).pipe(
    Effect.scoped,
    Effect.catchTag("PlatformError", (e) => new CommandFailed({ command, output: e.message })),
  )
}
