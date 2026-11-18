import { createSerializationAdapter } from "@tanstack/react-router"
import { createStart } from "@tanstack/react-start"

type Tagged = Error & { readonly _tag: string }

/**
 * A tagged error (an Effect `Data.TaggedError`, `NotConfigured`) reaches the browser with its
 * `_tag` and its other text fields; TanStack's own error serializer keeps only the message. Cards
 * and error pages match on `_tag`.
 */
const taggedError = createSerializationAdapter({
  key: "tagged-error",
  test: (value): value is Tagged =>
    value instanceof Error && "_tag" in value && typeof value._tag === "string",
  toSerializable: (error: Tagged) => ({
    ...Object.fromEntries(
      Object.entries(error).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    _tag: error._tag,
    message: error.message,
  }),
  fromSerializable: (fields: Record<string, string> & { _tag: string; message: string }) =>
    Object.assign(new Error(fields.message), fields, { name: fields._tag }) as Tagged,
})

export const startInstance = createStart(() => ({ serializationAdapters: [taggedError] }))
