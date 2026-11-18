import { Schema } from "effect"
// efforge.jsonc is read at build time; `efforge add` rewrites it, so what reads this stays true
import source from "../../../../efforge.jsonc?raw"

const Manifest = Schema.Struct({
  stack: Schema.Struct({
    runtime: Schema.String,
    database: Schema.String,
    orm: Schema.String,
    auth: Schema.String,
    infra: Schema.String,
    ai: Schema.String,
    extras: Schema.Array(Schema.String),
  }),
})

/** JSON with comments and trailing commas, as efforge writes it and you may edit it. */
const parseJsonc = (text: string): unknown =>
  JSON.parse(
    text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|,(?=\s*[}\]])/g, (match) =>
      match.startsWith('"') ? match : "",
    ),
  )

/** The choices this project was created with, as efforge.jsonc records them. */
export const stack = Schema.decodeUnknownSync(Manifest)(parseJsonc(source)).stack
