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
}).annotate({ title: "efforge list --json" })

const PinStatus = Schema.Literals(["same", "behind", "yours", "unmanaged"]).annotate({
  description:
    "behind: an efforge release pinned this version and this one pins another (upgrade moves it); yours: no release pinned it (never moved).",
})

const NeedsAction = Schema.Array(
  Schema.Struct({
    id: Schema.Literals([
      "effect-overrides",
      "package-manager",
      "split-set",
      "missing-seam",
      "install",
    ]),
    message: Schema.String,
    fix: Schema.NullOr(Schema.String).annotate({
      description:
        "A command after which this is fixed, or null (then `message` and `lines` say what to change).",
    }),
    lines: Schema.optionalKey(Schema.String),
  }),
).annotate({ description: "What breaks the project now. Not empty: exit code 2." })

const Kept = Schema.Array(
  Schema.Struct({
    path: Schema.String,
    status: Schema.Literals(["review", "held", "dropped"]).annotate({
      description:
        "review: you changed it and so did efforge's template; held: efforge's, held back to keep the project consistent; dropped: efforge no longer generates it, and you changed it.",
    }),
    reason: Schema.String,
    lines: Schema.optionalKey(
      Schema.String.annotate({ description: "The exact lines that would let efforge apply it." }),
    ),
  }),
).annotate({ description: "Files upgrade won't change for you, each with why." })

const Steps = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    description: Schema.String,
    command: Schema.optionalKey(Schema.String),
    cwd: Schema.optionalKey(Schema.String),
    file: Schema.optionalKey(Schema.String),
    lines: Schema.optionalKey(Schema.String),
    files: Schema.optionalKey(Strings),
    covers: Schema.optionalKey(
      Strings.annotate({ description: "The `upgrade` step: what it applies, by kind." }),
    ),
  }),
).annotate({ description: "What to do, in order, ending with the project's gate." })

export const UpgradeCheckOutput = Schema.Struct({
  ...Envelope,
  ok: Schema.Literal(true),
  check: Schema.Literal(true).annotate({
    description: "`--check`: a report; nothing was changed.",
  }),
  directory: Schema.String,
  stack: StackConfig,
  efforgeVersion: Schema.Struct({
    project: Schema.String.annotate({
      description: "The efforge version that made the project, or last upgraded it.",
    }),
    cli: Schema.String.annotate({ description: "This CLI's version, the one compared against." }),
    status: Schema.Literals(["same", "behind", "ahead"]),
  }),
  status: Schema.Literals(["needs-action", "behind", "current"]).annotate({
    description:
      "needs-action: something breaks the project (exit code 2); behind: nothing breaks, and upgrade has something to apply (exit code 3 with --strict, else 0); current: nothing to apply.",
  }),
  needsAction: NeedsAction,
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
      held: Schema.optionalKey(
        Schema.Boolean.annotate({
          description:
            "Behind, but kept: a pin of its set is yours, and moving this one would split the set.",
        }),
      ),
    }),
  ),
  sets: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      why: Schema.String,
      packages: Strings,
      split: Schema.Boolean.annotate({
        description: "efforge's pins in the set aren't ones a release pinned together: half moved.",
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
      ]),
      inPlace: Schema.optionalKey(
        Schema.Boolean.annotate({
          description:
            "A file efforge edits in place (layers.ts, AGENTS.md), judged by the record of what releases wrote.",
        }),
      ),
      held: Schema.optionalKey(
        Schema.Struct({ reason: Schema.String, lines: Schema.optionalKey(Schema.String) }).annotate(
          {
            description:
              "efforge would apply this file and holds it back to keep the project consistent.",
          },
        ),
      ),
      why: Schema.optionalKey(
        Schema.String.annotate({ description: "What efforge's change is for." }),
      ),
      diff: Schema.optionalKey(
        Schema.String.annotate({
          description: "With --diff: a git diff, yours -> efforge's today.",
        }),
      ),
    }),
  ),
  seams: Schema.Array(
    Schema.Struct({ file: Schema.String, missing: Strings, diff: Schema.String }),
  ).annotate({ description: "Files upgrade edits in place, and what it adds to each." }),
  scripts: Schema.Array(
    Schema.Struct({
      file: Schema.String,
      name: Schema.String,
      yours: Schema.String,
      efforge: Schema.String,
      status: Schema.Literals(["behind", "yours"]),
    }),
  ),
  kept: Kept,
  steps: Steps,
  warnings: Strings,
}).annotate({ title: "efforge upgrade --check --json" })

export const UpgradeApplyOutput = Schema.Struct({
  ...Envelope,
  ok: Schema.Literal(true),
  check: Schema.Literal(false).annotate({
    description: "`upgrade`: it applied (or, with --dry-run, would apply).",
  }),
  dryRun: Schema.Boolean,
  directory: Schema.String,
  stack: StackConfig,
  efforgeVersion: Schema.Struct({
    from: Schema.String,
    to: Schema.String.annotate({ description: "What efforge.jsonc records now." }),
  }),
  status: Schema.Literals(["needs-action", "current"]).annotate({
    description:
      "After applying: needs-action when something efforge can't fix still breaks the project (exit code 2).",
  }),
  created: Strings,
  changed: Strings,
  removed: Strings,
  installed: Schema.Boolean.annotate({ description: "pnpm install ran." }),
  kept: Kept,
  needsAction: NeedsAction,
  nextSteps: Schema.Array(Schema.Struct({ command: Schema.String, cwd: Schema.String })),
  warnings: Strings,
  diff: Schema.optionalKey(
    Schema.String.annotate({ description: "With --diff: what it changed, as a git diff." }),
  ),
}).annotate({ title: "efforge upgrade --json" })

export const UpgradeOutput = Schema.Union([UpgradeCheckOutput, UpgradeApplyOutput]).annotate({
  title: "efforge upgrade --json",
})

export const DoctorOutput = Schema.Struct({
  ...Envelope,
  ok: Schema.Literal(true),
  directory: Schema.String,
  stack: Schema.optionalKey(StackConfig),
  status: Schema.Literals(["ok", "warn", "fail"]).annotate({
    description: "The worst check: fail (exit code 2), then warn (or unverified), then ok.",
  }),
  checks: Schema.Array(
    Schema.Struct({
      id: Schema.String.annotate({ description: "Stable: node, pnpm, manifest, install, ..." }),
      status: Schema.Literals(["ok", "warn", "fail", "skipped", "unverified"]).annotate({
        description:
          "unverified: the check couldn't read what it looks for in the shape it knows; `details.lookedFor` says what.",
      }),
      message: Schema.String,
      fix: Schema.NullOr(Schema.String).annotate({
        description:
          "A command after which this check passes and no other check is worse, or null (then `message` and `details` say what to change).",
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
