import { Schema } from "effect"

export class TransformAnchorMissing extends Schema.TaggedError<TransformAnchorMissing>()(
  "TransformAnchorMissing",
  { file: Schema.String, anchor: Schema.String, snippet: Schema.String },
) {}

export class UnknownTransform extends Schema.TaggedError<UnknownTransform>()("UnknownTransform", {
  name: Schema.String,
}) {}
