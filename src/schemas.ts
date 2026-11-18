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
}).annotate({ title: "efforge list --json" })

const PinStatus = Schema.Literals(["same", "behind", "ahead", "unmanaged"])

export const UpgradeOutput = Schema.Struct({
  ...Envelope,
  ok: Schema.Literal(true),
  check: Schema.Literal(true).annotate({
    description:
      "A report; nothing was changed. (A later `upgrade` that applies changes will say false.)",
  }),
  directory: Schema.String,
  stack: StackConfig,
  efforgeVersion: Schema.Struct({
    project: Schema.String.annotate({ description: "The efforge version that made the project." }),
    cli: Schema.String.annotate({ description: "This CLI's version, the one compared against." }),
    status: Schema.Literals(["same", "behind", "ahead"]),
  }),
  drifted: Schema.Boolean.annotate({
    description:
      "True when a guard is missing or `--patch` would change something; then the exit code is 2. Files you edited never count.",
  }),
  pins: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      project: Schema.String,
      efforge: Schema.NullOr(Schema.String).annotate({
        description: "This efforge's pin, or null when it doesn't manage the package.",
      }),
      status: PinStatus,
      where: Schema.String.annotate({
        description: "`catalog`, `packageManager`, or the package.json that pins it exactly.",
      }),
      set: Schema.optionalKey(
        Schema.String.annotate({ description: "The set it moves with (see `sets`)." }),
      ),
    }),
  ),
  sets: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      why: Schema.String,
      packages: Strings,
      split: Schema.Boolean.annotate({
        description: "Some members are at efforge's pin and others aren't.",
      }),
    }),
  ).annotate({ description: "Sets of pins that move together, when one of them differs." }),
  guards: Schema.Array(
    Schema.Struct({
      id: Schema.Literals(["effect-overrides", "package-manager"]),
      ok: Schema.Boolean,
      message: Schema.String,
      missing: Schema.optionalKey(Strings),
    }),
  ),
  files: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      status: Schema.Literals([
        "current",
        "refresh",
        "review",
        "yours",
        "deleted",
        "dropped",
        "new",
        "differs",
      ]),
      diff: Schema.optionalKey(
        Schema.String.annotate({
          description: "With --diff: a git diff, yours -> efforge's today.",
        }),
      ),
    }),
  ),
  seams: Schema.Array(
    Schema.Struct({
      file: Schema.String,
      missing: Strings,
      diff: Schema.String,
      snippet: Schema.optionalKey(Schema.String),
    }),
  ),
  scripts: Schema.Array(
    Schema.Struct({
      file: Schema.String,
      name: Schema.String,
      yours: Schema.String,
      efforge: Schema.String,
    }),
  ),
  steps: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      description: Schema.String,
      command: Schema.optionalKey(Schema.String),
      cwd: Schema.optionalKey(Schema.String),
      file: Schema.optionalKey(Schema.String),
      lines: Schema.optionalKey(Schema.String),
      files: Schema.optionalKey(Strings),
      byAdd: Schema.optionalKey(Schema.Boolean),
    }),
  ).annotate({ description: "What to do, in order, ending with the project's gate." }),
  warnings: Strings,
  patch: Schema.optionalKey(
    Schema.String.annotate({
      description: "With --patch: every change except files you edited, as a git patch.",
    }),
  ),
}).annotate({ title: "efforge upgrade --check --json" })

export const DoctorOutput = Schema.Struct({
  ...Envelope,
  ok: Schema.Literal(true),
  directory: Schema.String,
  stack: Schema.optionalKey(StackConfig),
  status: Schema.Literals(["ok", "warn", "fail"]).annotate({
    description: "The worst check: fail (exit code 2), then warn, then ok.",
  }),
  checks: Schema.Array(
    Schema.Struct({
      id: Schema.String.annotate({ description: "Stable: node, pnpm, manifest, install, ..." }),
      status: Schema.Literals(["ok", "warn", "fail", "skipped"]),
      message: Schema.String,
      fix: Schema.NullOr(Schema.String).annotate({
        description: "A shell command that fixes it, or null (then `details` says what to change).",
      }),
      details: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  ),
}).annotate({ title: "efforge doctor --json" })

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
  "upgrade.schema.json": UpgradeOutput,
  "doctor.schema.json": DoctorOutput,
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
