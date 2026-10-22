import { Effect, FileSystem, Path, Schema } from "effect"
import type { Tree } from "./tree.ts"

export class TargetNotEmpty extends Schema.TaggedError<TargetNotEmpty>()("TargetNotEmpty", {
  dir: Schema.String,
}) {}

export class WriteFailed extends Schema.TaggedError<WriteFailed>()("WriteFailed", {
  dir: Schema.String,
  message: Schema.String,
}) {}

const ignorable = new Set([".git", ".DS_Store", "Thumbs.db"])

export type WriteError = TargetNotEmpty | WriteFailed

/** Writes `tree` under `dir`. Refuses an existing non-empty directory; creates it otherwise. */
export const writeTree = (
  dir: string,
  tree: Tree,
): Effect.Effect<void, WriteError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    if (yield* fs.exists(dir)) {
      const entries = yield* fs.readDirectory(dir)
      // an empty repo (only .git) or OS clutter still counts as empty
      if (entries.some((f) => !ignorable.has(f))) return yield* new TargetNotEmpty({ dir })
    }
    yield* fs.makeDirectory(dir, { recursive: true })
    for (const [rel, content] of tree) {
      const target = path.join(dir, rel)
      yield* fs.makeDirectory(path.dirname(target), { recursive: true })
      yield* fs.writeFileString(target, content)
    }
  }).pipe(Effect.catchTag("PlatformError", (e) => new WriteFailed({ dir, message: e.message })))
