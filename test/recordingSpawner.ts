import { Effect, Layer, Sink, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"

/**
 * A spawner that records `cmd args` and succeeds, so create's step order can be asserted.
 * `cwds`, when given, gets each call's working directory at the same index. `fail`, when given,
 * makes a command exit 1 with the output it returns (undefined: succeed).
 */
export const recordingSpawner = (
  calls: string[],
  cwds?: Array<string | undefined>,
  fail?: (command: string) => string | undefined,
) =>
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const c = command as unknown as {
        command: string
        args: string[]
        options: { cwd?: string }
      }
      const line = [c.command, ...c.args].join(" ")
      calls.push(line)
      cwds?.push(c.options.cwd)
      const output = fail?.(line)
      const out =
        output === undefined ? Stream.empty : Stream.make(new TextEncoder().encode(output))
      return Effect.succeed(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(output === undefined ? 0 : 1)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: out,
          stderr: Stream.empty,
          all: out,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        }),
      )
    }),
  )
