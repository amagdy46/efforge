import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"
import { capabilities } from "@/capabilities/registry"
// efforge.jsonc is read at build time; `efforge add` rewrites it, so the landing page stays true
import manifest from "../../../../efforge.jsonc?raw"

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

const decode = Schema.decodeUnknownSync(Manifest)

/** The stack from efforge.jsonc and the ids of the dashboard's cards, for the landing page. */
export const getStack = createServerFn({ method: "GET" }).handler(() => ({
  // the file is JSON after its `//` header line
  stack: decode(JSON.parse(manifest.replace(/^\s*\/\/.*$/gm, ""))).stack,
  cards: capabilities.map((capability) => capability.id),
}))
