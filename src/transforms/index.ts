import { Effect, Schema } from "effect"
import type { Tree } from "../tree.ts"

export class TransformAnchorMissing extends Schema.TaggedError<TransformAnchorMissing>()(
  "TransformAnchorMissing",
  { file: Schema.String, anchor: Schema.String, snippet: Schema.String },
) {}

export class UnknownTransform extends Schema.TaggedError<UnknownTransform>()("UnknownTransform", {
  name: Schema.String,
}) {}

export interface TransformCall {
  readonly name: string
  readonly args: Readonly<Record<string, string>>
}

/** Stub: Task 5 replaces the body with the real transform registry. */
export const runTransform = (
  tree: Tree,
  _t: TransformCall,
): Effect.Effect<Tree, TransformAnchorMissing | UnknownTransform> => Effect.succeed(tree)
