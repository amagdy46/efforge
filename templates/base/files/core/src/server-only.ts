import { Schema, SchemaGetter } from "effect"

/**
 * A field of a tagged error that stays on the server: the error keeps it (the
 * server log shows it), and encoding drops it, so it never reaches the browser.
 * Use it for a driver's raw error: `cause: ServerOnly`.
 */
export const ServerOnly = Schema.optionalKey(
  Schema.Unknown.pipe(
    Schema.encodeTo(Schema.optionalKey(Schema.Never), {
      decode: SchemaGetter.omit(),
      encode: SchemaGetter.omit(),
    }),
  ),
)
