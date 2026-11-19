import { Schema } from "effect"
import { CONTRACT, type ErrorCode, errorCodes } from "./contract.ts"
import { EfforgeManifest } from "./manifest.ts"
import { Ai, Auth, Database, Extra, Infra, Orm, Runtime, StackConfig } from "./stack.ts"

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
  secret: Schema.Boolean.annotate({
    description: "The value is a secret: the deployed one is never printed or committed.",
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
      docs: Schema.optionalKey(
        Schema.String.annotate({ description: "Its page in efforge's docs." }),
      ),
      card: Schema.optionalKey(
        Schema.String.annotate({
          description: "Its dashboard card module, when the project has one.",
        }),
      ),
      agents: Schema.optionalKey(
        Strings.annotate({
          description: "Headings of the AGENTS.md sections this run added for it.",
        }),
      ),
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
  nearby: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "When project is false: the efforge project around or beside the directory (a parent, or the one child that has one). Pass it as --cwd.",
    }),
  ),
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
  presets: Schema.Array(
    Schema.Struct({
      id: Schema.String.annotate({ description: "What to pass to `create --preset`." }),
      title: Schema.String,
      description: Schema.String,
      stack: Schema.Struct({
        runtime: Runtime,
        database: Database,
        orm: Orm,
        auth: Auth,
        infra: Infra,
        ai: Ai,
        extras: Schema.Array(Extra),
      }).annotate({
        description:
          "What the preset chooses in this version. A stack flag given with --preset overrides its slot.",
      }),
    }),
  ).annotate({
    description:
      "Named stacks for `create --preset`. Their contents can change between versions; `create` records the stack it made, flag by flag, never the preset.",
  }),
}).annotate({ title: "efforge list --json" })

const When = Schema.Record(Schema.String, Strings).annotate({
  description:
    "Only on stacks where every listed slot has one of the listed values (extras: any of them). Absent: on every stack. Inside a project, `info` lists only what that project gets, without it.",
})

export const InfoOutput = Schema.Struct({
  ...Envelope,
  ok: Schema.Literal(true),
  id: Schema.String.annotate({ description: "The add-on's full id, what `add` takes." }),
  slot: Schema.String,
  option: Schema.String,
  title: Schema.String,
  description: Schema.String,
  purpose: Schema.NullOr(Schema.String).annotate({
    description: "What it is for, in a paragraph.",
  }),
  docs: Schema.Struct({
    page: Schema.String.annotate({
      description: "Its page in efforge's repo: docs/addons/<slot>-<option>.md.",
    }),
    url: Schema.NullOr(Schema.String),
  }),
  service: Schema.NullOr(
    Schema.Struct({ name: Schema.String, file: Schema.String, errors: Strings }),
  ).annotate({
    description: "The Effect service it adds, the file that declares it, its tagged errors.",
  }),
  layer: Schema.NullOr(Schema.String).annotate({
    description: "What it adds to AppLayer in apps/web/src/server/layers.ts.",
  }),
  files: Schema.Array(
    Schema.Struct({ path: Schema.String, when: Schema.optionalKey(When) }),
  ).annotate({
    description:
      "The files it writes. A path can appear once per stack it is written differently on.",
  }),
  edits: Schema.Array(Schema.Struct({ file: Schema.String, transforms: Strings })).annotate({
    description: "The files it edits in place (the seams), with the transforms that edit each.",
  }),
  dependencies: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      version: Schema.String,
      package: Schema.String.annotate({ description: "The workspace package, `.` for the root." }),
      dev: Schema.Boolean,
    }),
  ),
  scripts: Schema.Array(
    Schema.Struct({ package: Schema.String, name: Schema.String, command: Schema.String }),
  ),
  env: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      description: Schema.String,
      example: Schema.String,
      secret: Schema.Boolean.annotate({
        description: "The value is a secret: the deployed one is never printed or committed.",
      }),
      set: Schema.Boolean.annotate({
        description:
          "efforge writes a working local value when it adds it; false means fill it in.",
      }),
      when: Schema.optionalKey(When),
    }),
  ),
  requires: Schema.Array(
    Schema.Struct({ slot: Schema.String, options: Strings, reason: Schema.String }),
  ).annotate({
    description: "What a project needs before it can have this add-on: one of `options` for each.",
  }),
  conflicts: Strings.annotate({ description: "Add-ons a project can't have with it." }),
  card: Schema.NullOr(
    Schema.Struct({ module: Schema.String, export: Schema.String, when: Schema.optionalKey(When) }),
  ).annotate({ description: "Its dashboard card module (on /app), or null." }),
  agents: Schema.Array(
    Schema.Struct({ heading: Schema.String, when: Schema.optionalKey(When) }),
  ).annotate({
    description: "The AGENTS.md sections it adds, by heading.",
  }),
  project: Schema.optionalKey(
    Schema.Struct({
      directory: Schema.String,
      installed: Schema.Boolean,
      add: Schema.NullOr(Schema.String).annotate({
        description:
          "The command that adds it to this project, or null (it has it, or can't add it alone).",
      }),
      alternatives: Strings.annotate({
        description: "When it can't be added alone: each command that adds it with what it needs.",
      }),
      reason: Schema.optionalKey(Schema.String),
    }),
  ).annotate({
    description: "Only in an efforge project (--cwd, default: the current directory).",
  }),
}).annotate({ title: "efforge info --json" })

const Layered = Schema.NullOr(Strings)

export const GraphOutput = Schema.Struct({
  ...Envelope,
  ok: Schema.Literal(true),
  directory: Schema.String,
  file: Schema.String.annotate({ description: "The file the graph is read from." }),
  layers: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      expression: Schema.String.annotate({
        description: "The argument of Layer.mergeAll as written.",
      }),
      addon: Schema.NullOr(Schema.String).annotate({
        description:
          "The add-on that adds it (`base` for the logger), or null for a layer you added.",
      }),
      provides: Layered.annotate({
        description: "The services it provides; null when unknown (your own layer).",
      }),
      needs: Layered.annotate({
        description:
          "What it needs: layers provided to it in layers.ts, bindings and settings; null when unknown.",
      }),
      color: Schema.String.annotate({
        description: "Its tempering colour, by its place in the list.",
      }),
    }),
  ),
  nodes: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.Literals(["app", "layer", "need"]),
      label: Schema.String,
    }),
  ),
  edges: Schema.Array(
    Schema.Struct({
      from: Schema.String,
      to: Schema.String,
      kind: Schema.Literals(["merges", "needs"]).annotate({
        description: "merges: a layer into AppLayer; needs: what a layer needs, into the layer.",
      }),
    }),
  ),
  mermaid: Schema.String.annotate({
    description: "The graph as a Mermaid flowchart, what `graph` prints.",
  }),
  written: Schema.NullOr(Schema.String).annotate({
    description: "With --write: the file the graph was written to (README.md); else null.",
  }),
}).annotate({ title: "efforge graph --json" })

export const ErrorOutput = Schema.Struct({
  ...Envelope,
  ok: Schema.Literal(false),
  error: Schema.Struct({
    // open on purpose: a new code is not a change of contract, so an older copy of this schema
    // must still accept a document from a newer CLI
    code: Schema.String.annotate({
      description: `A stable identifier. Known codes: ${(Object.keys(errorCodes) as ErrorCode[]).join(", ")}. New codes can appear within a contract version; treat an unknown one like any failure.`,
    }),
    message: Schema.String,
    fix: Schema.NullOr(Schema.String).annotate({
      description:
        "A command that does what you were trying to do, or null when there is none (then the other fields hold the facts, and `alternatives`, when present, the ways out to choose from).",
    }),
  }).annotate({ description: "More fields depend on `code`; see docs/json.md." }),
}).annotate({ title: "efforge --json error" })

/** File name -> schema, for `schemas/`. */
export const published = {
  "efforge.schema.json": EfforgeManifest,
  "create.schema.json": CreateOutput,
  "add.schema.json": AddOutput,
  "list.schema.json": ListOutput,
  "info.schema.json": InfoOutput,
  "graph.schema.json": GraphOutput,
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
