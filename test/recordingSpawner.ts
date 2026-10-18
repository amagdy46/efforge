import { Effect, Layer, Sink, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"

/** A spawner that records `cmd args` and succeeds, so create's step order can be asserted. */
export const recordingSpawner = (calls: string[]) =>
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const c = command as unknown as { command: string; args: string[] }
      calls.push([c.command, ...c.args].join(" "))
      return Effect.succeed(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: Stream.empty,
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        }),
      )
    }),
  )
