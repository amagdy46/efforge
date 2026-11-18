import { Schema } from "effect"
import { CONTRACT, type ErrorCode, errorCodes } from "./contract.ts"
import { EfforgeManifest } from "./manifest.ts"
import { StackConfig } from "./stack.ts"

// The `--json` documents (docs/json.md) as schemas. Tests decode real output with them, and
// `node scripts/schemas.ts` writes them to `schemas/` as JSON Schema, shipped in the package.

const Envelope = {
  efforge: Schema.String.annotate({ description: "The CLI version that printed this." }),
  contract: Schema.Literal(CONTRACT).annotate({
    description:
      "The version of this contract. It changes only when a field is renamed, removed or changes meaning.",
  }),
}

const Step = Schema.Struct({
  command: Schema.String.annotate({ description: "A shell command." }),
  cwd: Schema.String.annotate({ description: "The absolute directory to run it in." }),
  note: Schema.optionalKey(Schema.String),
  longRunning: Schema.optionalKey(
    Schema.Literal(true).annotate({
      description: "Runs until stopped (a dev server): start it in the background.",
    }),
  ),
}).annotate({ description: "One step still to run, in order." })

const EnvVar = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  file: Schema.String.annotate({
    description: "Where the local value is read from (.dev.vars, or .env with Alchemy).",
  }),
  set: Schema.Boolean.annotate({
    description: "efforge already wrote a working local value; false means fill it in.",
  }),
})

const Strings = Schema.Array(Schema.String)

export const CreateOutput = Schema.Struct({
  ...Envelope,
  ok: Schema.Literal(true),
  dryRun: Schema.Boolean,
  directory: Schema.String.annotate({ description: "The project directory (absolute)." }),
  stack: StackConfig,
  command: Schema.String.annotate({
    description: "A non-interactive command that creates this stack again.",
  }),
  files: Strings.annotate({ description: "Every file written (or that would be), sorted." }),
  installed: Schema.Boolean.annotate({ description: "pnpm install ran." }),
  git: Schema.Literals(["skipped", "initialized", "committed"]),
  env: Schema.Array(EnvVar),
  nextSteps: Schema.Array(Step),
  warnings: Strings,
}).annotate({ title: "efforge create --json" })

export const AddOutput = Schema.Struct({
  ...Envelope,
  ok: Schema.Literal(true),
  dryRun: Schema.Boolean,
  directory: Schema.String,
  stack: StackConfig.annotate({ description: "The stack after this run." }),
  added: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      docs: Schema.optionalKey(Schema.String),
    }),
  ),
  skipped: Strings.annotate({
    description: "Ids already in the stack, and files already as efforge would write them.",
  }),
  created: Strings,
  changed: Strings.annotate({ description: "Existing files that were changed." }),
  removed: Strings,
  replacedScripts: Strings.annotate({
    description: "`<package.json>: <script>` entries an add-on replaced.",
  }),
  packageManager: Schema.NullOr(Schema.Struct({ from: Schema.String, to: Schema.String })).annotate(
    {
      description:
        "The root packageManager, when this run raised it so pnpm honours the Effect overrides (0.2.0 projects); else null.",
    },
  ),
  notes: Strings.annotate({ description: "Things left to do by hand, one line each." }),
  installed: Schema.Boolean.annotate({ description: "pnpm install ran in this run." }),
  env: Schema.Array(EnvVar),
  nextSteps: Schema.Array(Step),
  warnings: Strings,
}).annotate({ title: "efforge add --json" })

export const ListOutput = Schema.Struct({
  ...Envelope,
  ok: Schema.Literal(true),
  project: Schema.Boolean.annotate({
    description: "--cwd (default: the current directory) is an efforge project.",
  }),
  directory: Schema.optionalKey(Schema.String),
  stack: Schema.optionalKey(StackConfig),
  addons: Schema.Array(
    Schema.Struct({
      id: Schema.String.annotate({ description: "What to pass to `add`." }),
      slot: Schema.String,
      option: Schema.String,
      title: Schema.String,
      description: Schema.String,
      installed: Schema.optionalKey(Schema.Boolean),
    }),
  ),
}).annotate({ title: "efforge list --json" })

export const ErrorOutput = Schema.Struct({
  ...Envelope,
  ok: Schema.Literal(false),
  error: Schema.Struct({
    code: Schema.Literals(Object.keys(errorCodes) as [ErrorCode, ...ErrorCode[]]),
    message: Schema.String,
    fix: Schema.NullOr(Schema.String).annotate({
      description: "A command to run instead, or null when there is none.",
    }),
  }).annotate({ description: "More fields depend on `code`; see docs/json.md." }),
}).annotate({ title: "efforge --json error" })

/** File name -> schema, for `schemas/`. */
export const published = {
  "efforge.schema.json": EfforgeManifest,
  "create.schema.json": CreateOutput,
  "add.schema.json": AddOutput,
  "list.schema.json": ListOutput,
  "error.schema.json": ErrorOutput,
} as const

/** A standalone JSON Schema (draft 2020-12) file for `schema`. */
export const jsonSchemaFile = (name: string, schema: Schema.Top): string => {
  const doc = Schema.toJsonSchemaDocument(schema)
  const defs = Object.keys(doc.definitions).length > 0 ? { $defs: doc.definitions } : {}
  return `${JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: `https://unpkg.com/create-efforge/schemas/${name}`,
      ...doc.schema,
      ...defs,
    },
    null,
    2,
  )}\n`
}
