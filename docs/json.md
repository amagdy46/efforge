# `--json`: the contract for scripts and coding agents

`create`, `add` and `list` take `--json`. With it, a run prints exactly one JSON document on stdout and nothing else, whether it succeeds or fails. Nothing goes to stderr either, except what a child process prints when it crashes outright. Progress is not printed; warnings and skipped steps go into the document. `--json` never prompts: on `create` it implies `--yes`.

This page is the contract. Every example on it is the real output of the command above it, checked by `test/json-docs.test.ts` (paths shortened to `/home/me/projects`, long `files` and `addons` lists cut to three items). JSON Schemas for the documents ship in the package under `schemas/` ([create](../schemas/create.schema.json), [add](../schemas/add.schema.json), [list](../schemas/list.schema.json), [error](../schemas/error.schema.json)).

Run efforge as `npx -y create-efforge ...` (create-efforge 0.3.0 or later; a document without `contract` comes from an older CLI). Under `npm create efforge`, npm prints its own lines on stdout before efforge's.

## Every document

| Field | |
|---|---|
| `efforge` | The CLI version that printed it. |
| `contract` | The contract version, `1`. It changes only when a field is renamed or removed, or changes meaning. New fields and new error codes can appear without a change, so ignore what you don't know: adding a code is not a breaking change. |
| `ok` | `true` on success, `false` on failure. |

On failure, the document is `{ efforge, contract, ok: false, error }` and `error` has:

| Field | |
|---|---|
| `code` | A stable identifier from [the list below](#error-codes). |
| `message` | One or two sentences for a person. Don't parse it. |
| `fix` | The command to run instead, ready to paste, or `null`. See [`fix` is a promise](#fix-is-a-promise). |
| other fields | Depend on `code`: the closest flag, the allowed values, the files in conflict. Listed per code below. |

The schemas in `schemas/` leave `code` an open string for the same reason: a schema from an older package must still accept a document from a newer CLI.

### `fix` is a promise

A `fix` is either a command that does what you were trying to do, or `null` with the facts you need to decide (allowed values, add-on ids, paths). It never swaps in a different capability, never creates something you didn't ask for, and never stops at a prompt:

- It is your own command with the smallest change that gets past the error, so it keeps your flags (`--json`, `--dry-run`, `--cwd`). It may start with `cd <dir> &&`.
- It starts with `npx -y create-efforge`. `-y` keeps npx from asking before a download. If you ran a pinned version (`create-efforge@0.3.0`) or `@latest`, run the fix with the same package spec, or npx may run a different cached version.
- A `create` that would prompt gets `--yes`.
- A value is corrected only when what you typed is a clear typo of exactly one valid value. The rule: an option of one or two characters (`d1`) is only matched exactly; otherwise one edit (a swap of two neighbouring letters counts as one) for options up to six characters, two for longer ones. `--database=postgress` gets `--database=postgres`; `--database=mysql`, `--database=d2` and `add stripe` get `fix: null`, with `allowed` or `addons` to choose from.
- `fix` never renames your project or joins stray words into a name.

## Exit codes

| Code | |
|---|---|
| `0` | Success. Also answering No at the confirmation prompt (never under `--json`). |
| `1` | Any error, including a mistyped flag. With `--json`, the document says which. |
| `130` | Stopped: Ctrl-C, SIGTERM, or a tool's timeout. With `--json`, `create` prints an [`Interrupted`](#interrupted) document saying what was written and how to finish. |

## Not part of the contract

`--help`, `--completions` and `--wizard` print text for people, with or without `--json`. `--version --json` prints the envelope alone (`{ efforge, contract, ok: true }`), which is the cheapest way to check which CLI and contract you have.

## `create`

`directory` is absolute. `files` lists everything written, sorted. `installed` says whether `pnpm install` ran; `git` is `committed`, `initialized` (git init worked, the commit didn't) or `skipped`. `command` recreates the same stack without prompts.

`env` lists every env var the project reads: `file` is where the local value lives (`.dev.vars`, or `.env` with Alchemy) and `set` says whether efforge wrote a local value there. When `set` is false, read `description`: some variables have a default (`DATABASE_URL` falls back to the docker-compose database), others must be filled in before the feature works. Production values are set as the description says, usually with `wrangler secret put`.

`nextSteps` are the commands still to run, in order, each with the directory to run it in (`cwd`). A step with `longRunning: true` (the dev server) doesn't exit on its own: start it in the background or leave it to the user.

<!-- example: create -->

```sh
npx -y create-efforge create my-app --json --database=d1 --auth=better-auth
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": true,
  "dryRun": false,
  "directory": "/home/me/projects/my-app",
  "stack": {
    "name": "my-app",
    "runtime": "cloudflare",
    "database": "d1",
    "orm": "drizzle",
    "auth": "better-auth",
    "infra": "none",
    "ai": "none",
    "extras": []
  },
  "command": "npx -y create-efforge create my-app --yes --database=d1 --auth=better-auth",
  "files": [
    ".dev.vars",
    ".env.example",
    ".gitignore",
    "... 73 more"
  ],
  "installed": true,
  "git": "committed",
  "env": [
    {
      "name": "BETTER_AUTH_SECRET",
      "description": "Signs sessions and cookies (local: .dev.vars; production: wrangler secret put BETTER_AUTH_SECRET)",
      "file": ".dev.vars",
      "set": true
    },
    {
      "name": "BETTER_AUTH_URL",
      "description": "Public origin of the app, used for redirects and trusted origins (a Worker var in production)",
      "file": ".dev.vars",
      "set": true
    }
  ],
  "nextSteps": [
    {
      "command": "pnpm db:migrate",
      "note": "local D1",
      "cwd": "/home/me/projects/my-app"
    },
    {
      "command": "pnpm dev",
      "note": "http://localhost:5173",
      "longRunning": true,
      "cwd": "/home/me/projects/my-app"
    }
  ],
  "warnings": []
}
```

With `--dry-run`, nothing is written: `files` is what would be, and `nextSteps` is the command without `--dry-run`, run where you are.

<!-- example: create-dry-run -->

```sh
npx -y create-efforge create my-app --json --dry-run
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": true,
  "dryRun": true,
  "directory": "/home/me/projects/my-app",
  "stack": {
    "name": "my-app",
    "runtime": "cloudflare",
    "database": "postgres",
    "orm": "drizzle",
    "auth": "better-auth-orgs",
    "infra": "none",
    "ai": "none",
    "extras": []
  },
  "command": "npx -y create-efforge create my-app --yes",
  "files": [
    ".dev.vars",
    ".env.example",
    ".gitignore",
    "... 79 more"
  ],
  "installed": false,
  "git": "skipped",
  "env": [
    {
      "name": "DATABASE_URL",
      "description": "Used by `pnpm db:migrate` and drizzle-kit, read from the shell; unset, they use the docker-compose database. The running app connects through the HYPERDRIVE binding.",
      "file": ".dev.vars",
      "set": false
    },
    {
      "name": "BETTER_AUTH_SECRET",
      "description": "Signs sessions and cookies (local: .dev.vars; production: wrangler secret put BETTER_AUTH_SECRET)",
      "file": ".dev.vars",
      "set": true
    },
    {
      "name": "BETTER_AUTH_URL",
      "description": "Public origin of the app, used for redirects and trusted origins (a Worker var in production)",
      "file": ".dev.vars",
      "set": true
    }
  ],
  "nextSteps": [
    {
      "command": "npx -y create-efforge create my-app --json",
      "cwd": "/home/me/projects",
      "note": "create it for real"
    }
  ],
  "warnings": []
}
```

## `add`

`stack` is the project's stack afterwards. `created` and `changed` are the files this run created and changed, `removed` the generated files it deleted (`wrangler.jsonc` when you add Alchemy), `skipped` the ids the project already had and files already as efforge would write them. `replacedScripts` names package scripts an add-on replaced. `packageManager` is `{from, to}` when `add` raised the root `packageManager` (projects made by efforge 0.2.0, whose pnpm ignored the Effect overrides), else `null`. `notes` are things left to do by hand, one line each (for example, the widgets line to add to a dashboard you edited). `installed` says whether `pnpm install` ran in this run; when it didn't and should, `nextSteps` starts with it. `env` lists only the env vars this run added.

<!-- example: add -->

```sh
npx -y create-efforge add email --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": true,
  "dryRun": false,
  "directory": "/home/me/projects/my-app",
  "stack": {
    "name": "my-app",
    "runtime": "cloudflare",
    "database": "d1",
    "orm": "drizzle",
    "auth": "better-auth",
    "infra": "none",
    "ai": "none",
    "extras": [
      "email"
    ]
  },
  "added": [
    {
      "id": "extras/email",
      "title": "Email"
    }
  ],
  "skipped": [],
  "created": [
    "apps/web/src/server/mailer.ts",
    "packages/core/src/mailer.ts"
  ],
  "changed": [
    ".dev.vars",
    ".env.example",
    "AGENTS.md",
    "apps/web/src/server/layers.ts",
    "efforge.jsonc",
    "packages/core/src/index.ts",
    "wrangler.jsonc"
  ],
  "removed": [],
  "replacedScripts": [],
  "packageManager": null,
  "notes": [],
  "installed": false,
  "env": [
    {
      "name": "MAIL_FROM",
      "description": "Sender address; its domain must be enabled for Cloudflare Email Sending (wrangler email sending enable <domain>)",
      "file": ".dev.vars",
      "set": true
    },
    {
      "name": "MAIL_TRANSPORT",
      "description": "cloudflare (default) sends through the EMAIL binding; console prints emails instead (used by .dev.vars)",
      "file": ".dev.vars",
      "set": true
    }
  ],
  "nextSteps": [
    {
      "command": "pnpm install --no-frozen-lockfile",
      "cwd": "/home/me/projects/my-app"
    }
  ],
  "warnings": []
}
```

With `--dry-run`, the same document says what would change, and nothing is written or installed.

<!-- example: add-dry-run -->

```sh
npx -y create-efforge add ai storage --json --dry-run --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": true,
  "dryRun": true,
  "directory": "/home/me/projects/my-app",
  "stack": {
    "name": "my-app",
    "runtime": "cloudflare",
    "database": "d1",
    "orm": "drizzle",
    "auth": "better-auth",
    "infra": "none",
    "ai": "effect-ai-byok",
    "extras": [
      "storage"
    ]
  },
  "added": [
    {
      "id": "ai/effect-ai-byok",
      "title": "Effect AI (bring your own key)"
    },
    {
      "id": "extras/storage",
      "title": "Storage"
    }
  ],
  "skipped": [],
  "created": [
    "apps/web/src/server/ai.ts",
    "apps/web/src/server/llm-provider.ts",
    "apps/web/src/server/llm.ts",
    "apps/web/src/server/storage-route.ts",
    "apps/web/src/server/storage.ts",
    "packages/core/src/llm.ts",
    "packages/core/src/storage-security.ts",
    "packages/core/src/storage.ts",
    "packages/core/test/storage-security.test.ts"
  ],
  "changed": [
    ".dev.vars",
    ".env.example",
    "AGENTS.md",
    "apps/web/package.json",
    "apps/web/src/server/layers.ts",
    "apps/web/src/server/routes.ts",
    "efforge.jsonc",
    "packages/core/src/index.ts",
    "pnpm-workspace.yaml",
    "wrangler.jsonc"
  ],
  "removed": [],
  "replacedScripts": [],
  "packageManager": null,
  "notes": [],
  "installed": false,
  "env": [
    {
      "name": "LLM_PROVIDER",
      "description": "anthropic | openai | openrouter | ollama",
      "file": ".dev.vars",
      "set": true
    },
    {
      "name": "LLM_MODEL",
      "description": "Model id for the provider",
      "file": ".dev.vars",
      "set": true
    },
    {
      "name": "LLM_API_KEY",
      "description": "Provider API key (not needed for a local Ollama); a Worker secret in production",
      "file": ".dev.vars",
      "set": false
    },
    {
      "name": "LLM_BASE_URL",
      "description": "Optional OpenAI-compatible endpoint (openai, ollama)",
      "file": ".dev.vars",
      "set": false
    },
    {
      "name": "STORAGE_SIGNING_SECRET",
      "description": "HMAC secret for signed download URLs (wrangler secret put STORAGE_SIGNING_SECRET)",
      "file": ".dev.vars",
      "set": true
    }
  ],
  "nextSteps": [
    {
      "command": "pnpm install --no-frozen-lockfile",
      "cwd": "/home/me/projects/my-app"
    }
  ],
  "warnings": []
}
```

## `list`

`addons` has every add-on you can pick or add: `id` is what `add` takes. Inside an efforge project (or with `--cwd`), `project` is `true`, the document has the project's `directory` and `stack`, and each add-on has `installed`.

<!-- example: list -->

```sh
npx -y create-efforge list --json
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": true,
  "project": false,
  "addons": [
    {
      "id": "database/postgres",
      "slot": "database",
      "option": "postgres",
      "title": "Postgres",
      "description": "Postgres reached through a Hyperdrive binding on Workers, with a local docker-compose database and the `@repo/db` package."
    },
    {
      "id": "database/d1",
      "slot": "database",
      "option": "d1",
      "title": "Cloudflare D1",
      "description": "A D1 binding (SQLite on Cloudflare) and the `@repo/db` package."
    },
    {
      "id": "orm/drizzle",
      "slot": "orm",
      "option": "drizzle",
      "title": "Drizzle ORM",
      "description": "Drizzle 1.0 with its Effect drivers behind the Database service; migrations come from drizzle-kit."
    },
    "... 10 more"
  ]
}
```

<!-- example: list-project -->

```sh
npx -y create-efforge list --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": true,
  "project": true,
  "directory": "/home/me/projects/my-app",
  "stack": {
    "name": "my-app",
    "runtime": "cloudflare",
    "database": "d1",
    "orm": "drizzle",
    "auth": "better-auth",
    "infra": "none",
    "ai": "none",
    "extras": []
  },
  "addons": [
    {
      "id": "database/postgres",
      "slot": "database",
      "option": "postgres",
      "title": "Postgres",
      "description": "Postgres reached through a Hyperdrive binding on Workers, with a local docker-compose database and the `@repo/db` package.",
      "installed": false
    },
    {
      "id": "database/d1",
      "slot": "database",
      "option": "d1",
      "title": "Cloudflare D1",
      "description": "A D1 binding (SQLite on Cloudflare) and the `@repo/db` package.",
      "installed": true
    },
    {
      "id": "orm/drizzle",
      "slot": "orm",
      "option": "drizzle",
      "title": "Drizzle ORM",
      "description": "Drizzle 1.0 with its Effect drivers behind the Database service; migrations come from drizzle-kit.",
      "installed": true
    },
    "... 10 more"
  ]
}
```

## Error codes

### `UnknownFlag`

A flag efforge doesn't have.

Fields: `flag` (as typed), `suggestions` (closest flags). `fix`: The command with the flag corrected when it is a clear typo of one (the rule above); without it when it repeats a flag you also passed (`--jsn --json`); otherwise `null`, since dropping a flag you asked for would do something else.

<!-- example: UnknownFlag -->

```sh
npx -y create-efforge create my-app --json --databse=d1
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "UnknownFlag",
    "message": "Unknown flag --databse. Did you mean --database? Run npx -y create-efforge create --help to see every flag.",
    "fix": "npx -y create-efforge create my-app --json --database=d1",
    "flag": "--databse",
    "suggestions": [
      "--database"
    ]
  }
}
```

### `InvalidFlagValue`

A flag got a value it can't take, or no value.

Fields: `flag`, `value`, `expected`, and `allowed` for a stack flag. `fix`: For an on/off flag, the bare flag; for `--log-level`, the command without it; for a stack flag, `null`: which value is your choice.

<!-- example: InvalidFlagValue -->

```sh
npx -y create-efforge create my-app --json --database
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "InvalidFlagValue",
    "message": "Missing value for flag --database. Expected: string. Run npx -y create-efforge create --help to see every flag.",
    "fix": null,
    "flag": "--database",
    "value": "",
    "expected": "string",
    "allowed": [
      "postgres",
      "d1",
      "none"
    ]
  }
}
```

### `UnexpectedArgument`

More positional arguments than the command takes.

Fields: `arguments`. `fix`: For `create`, `null`: a project name is one word, and efforge doesn't guess which. For `list`, the command without them.

<!-- example: UnexpectedArgument -->

```sh
npx -y create-efforge create my app --json
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "UnexpectedArgument",
    "message": "Unexpected positional argument: \"app\". Run npx -y create-efforge create --help to see every flag.",
    "fix": null,
    "arguments": [
      "app"
    ]
  }
}
```

### `UnknownCommand`

The root form (`npx -y create-efforge <name>`) creates a project, so efforge refuses a first word that doesn't look like a name: a typo of a command (`lst`, `ad`, `crate`, by the rule above), a reserved word (`help`, `version`, and the names of commands to come: `upgrade`, `doctor`, `info`, `graph`), more than one word (`remove email`), or one word with a flag only `add` and `list` take (`foo --cwd my-app`). This check runs before anything else, so a mistyped `add email --cwd my-app` is reported as the mistyped command, not as a create with a stray `--cwd`.

Fields: `command` (as typed), `suggestion` (when it is a typo of a real command), `commands`, and `arguments` or `flag` when those were the reason. `fix`: The command with the right command name, keeping every argument; otherwise `null`. To really name a project `lst` or `help`, run `npx -y create-efforge create lst`.

<!-- example: UnknownCommand -->

```sh
npx -y create-efforge lst --json
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "UnknownCommand",
    "message": "Unknown command lst. Did you mean list? The commands are create, add, list. To name a project lst, run npx -y create-efforge create lst.",
    "fix": "npx -y create-efforge list --json",
    "command": "lst",
    "suggestion": "list",
    "commands": [
      "create",
      "add",
      "list"
    ]
  }
}
```

### `NeedsInput`

Without `--json` and without a terminal (stdin is not a TTY, or `CI` is set), a prompt was needed. It fails at once instead of waiting. `--json` never prompts, so it never returns this code; the example is the text on stderr.

Fields: `prompt` (`name`, `confirm` or a slot id), `flag`, `allowed`. `fix`: The command with `--yes`, which takes the default for every choice a flag didn't make.

<!-- example: NeedsInput -->

```sh
npx -y create-efforge create my-app
```

```text
No terminal to ask for "database": pass --database=postgres|d1|none, or --yes to accept the defaults.
Try: npx -y create-efforge create my-app --yes
```

### `UnknownValue`

A stack flag got a value that isn't one of its options.

Fields: `flag`, `value`, `allowed`. `fix`: The command with the option, when the value is a clear typo of exactly one; otherwise `null`. Pick from `allowed`, and if what you want isn't there, efforge doesn't offer it.

<!-- example: UnknownValue -->

```sh
npx -y create-efforge create my-app --json --database=mysql
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "UnknownValue",
    "message": "Unknown --database=mysql. Options: postgres, d1, none. It isn't a clear typo of any of them, so there is no fix; efforge offers nothing else here.",
    "fix": null,
    "flag": "--database",
    "value": "mysql",
    "allowed": [
      "postgres",
      "d1",
      "none"
    ]
  }
}
```

### `IncompatibleStack`

`create`: two choices conflict. `orm` is set exactly when `database` is, and `auth` needs a database. `add`: the add-on needs others with it (auth on a project without a database).

Fields: `flag` and `value` (create) or `slot` and `value` (add), `allowed`, `reason`; for `add`, `needs` lists the ids to add in the same command. `fix`: `create`: the conflicting flag set to an allowed value. `add`: the same command with `needs` added.

<!-- example: IncompatibleStack -->

```sh
npx -y create-efforge create my-app --json --database=none --auth=better-auth
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "IncompatibleStack",
    "message": "--auth=better-auth can't be used here: auth stores users in the database, and the database is none.",
    "fix": "npx -y create-efforge create my-app --json --database=none --auth=none",
    "flag": "--auth",
    "value": "better-auth",
    "allowed": [
      "none"
    ],
    "reason": "auth stores users in the database, and the database is none"
  }
}
```

### `InvalidProjectName`

The name isn't a valid npm package name, or is a path.

Fields: `name`. `fix`: The command with a valid name made from it (`My App` becomes `my-app`).

<!-- example: InvalidProjectName -->

```sh
npx -y create-efforge create 'My App' --json
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "InvalidProjectName",
    "message": "\"My App\" isn't a valid npm package name: use lowercase letters, digits, - . _ ~ (optionally @scope/name)",
    "fix": "npx -y create-efforge create my-app --json",
    "name": "My App"
  }
}
```

### `TargetNotEmpty`

The project directory exists and has files in it (a directory holding only `.git` counts as empty). Nothing was written. `fix` never proposes another name: an agent retrying after a timeout would end with two projects.

Fields: `directory`, `project` (whether it holds an efforge project). When it does: `stack`, `remaining` (setup steps that never ran: install and format when `node_modules` has no completed install, the commit when the repo has none) and `nextSteps` (those, then the usual steps for the stack). `fix`: The remaining steps, run in the project, when there are any; otherwise `null`: use the project as it is, or pick another name.

Here, `./my-app` holds a project whose install never ran.

<!-- example: TargetNotEmpty -->

```sh
npx -y create-efforge create my-app --json
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "TargetNotEmpty",
    "message": "/home/me/projects/my-app already holds an efforge project (my-app) whose setup didn't finish. To finish it, run there: pnpm install --no-frozen-lockfile, then pnpm format. Or pick another name.",
    "fix": "cd my-app && pnpm install --no-frozen-lockfile && pnpm format",
    "directory": "/home/me/projects/my-app",
    "project": true,
    "stack": {
      "name": "my-app",
      "runtime": "cloudflare",
      "database": "d1",
      "orm": "drizzle",
      "auth": "better-auth",
      "infra": "none",
      "ai": "none",
      "extras": []
    },
    "remaining": [
      "pnpm install --no-frozen-lockfile",
      "pnpm format"
    ],
    "nextSteps": [
      {
        "command": "pnpm install --no-frozen-lockfile",
        "cwd": "/home/me/projects/my-app"
      },
      {
        "command": "pnpm format",
        "cwd": "/home/me/projects/my-app"
      },
      {
        "command": "pnpm db:migrate",
        "note": "local D1",
        "cwd": "/home/me/projects/my-app"
      },
      {
        "command": "pnpm dev",
        "note": "http://localhost:5173",
        "longRunning": true,
        "cwd": "/home/me/projects/my-app"
      }
    ]
  }
}
```

### `PnpmMissing`

pnpm isn't on PATH. Checked before anything is written.

Fields: none. `fix`: Install pnpm, then the same command. `--no-install` also gets past it.

Here, pnpm is not installed.

<!-- example: PnpmMissing -->

```sh
npx -y create-efforge create my-app --json
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "PnpmMissing",
    "message": "efforge projects use pnpm, and it isn't on your PATH. Install it (npm install --global pnpm, or https://pnpm.io/installation) and re-run, or pass --no-install.",
    "fix": "npm install --global pnpm && npx -y create-efforge create my-app --json"
  }
}
```

### `SetupIncomplete`

The files were written, then a setup step failed (usually `pnpm install`, often the network).

Fields: `failed` (the command), `remaining` (setup commands still to run), `output` (its last 15 lines), and what the success document would have carried: `directory`, `stack`, `command`, `files`, `env` and `nextSteps` (the remaining setup, then the usual steps). `fix`: The remaining commands, run in the project.

Here, the registry is unreachable.

<!-- example: SetupIncomplete -->

```sh
npx -y create-efforge create my-app --json
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "SetupIncomplete",
    "message": "`pnpm install --no-frozen-lockfile` failed. The files are in /home/me/projects/my-app; to finish, run there: pnpm install --no-frozen-lockfile, then pnpm format, then git add -A && git commit -m 'Initial commit'",
    "fix": "cd my-app && pnpm install --no-frozen-lockfile && pnpm format && git add -A && git commit -m 'Initial commit'",
    "failed": "pnpm install --no-frozen-lockfile",
    "remaining": [
      "pnpm install --no-frozen-lockfile",
      "pnpm format",
      "git add -A && git commit -m 'Initial commit'"
    ],
    "output": "ERR_PNPM_META_FETCH_FAIL  GET https://registry.npmjs.org/effect: request to registry.npmjs.org failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org",
    "directory": "/home/me/projects/my-app",
    "stack": {
      "name": "my-app",
      "runtime": "cloudflare",
      "database": "postgres",
      "orm": "drizzle",
      "auth": "better-auth-orgs",
      "infra": "none",
      "ai": "none",
      "extras": []
    },
    "command": "npx -y create-efforge create my-app --yes",
    "files": [
      ".dev.vars",
      ".env.example",
      ".gitignore",
      "... 79 more"
    ],
    "env": [
      {
        "name": "DATABASE_URL",
        "description": "Used by `pnpm db:migrate` and drizzle-kit, read from the shell; unset, they use the docker-compose database. The running app connects through the HYPERDRIVE binding.",
        "file": ".dev.vars",
        "set": false
      },
      {
        "name": "BETTER_AUTH_SECRET",
        "description": "Signs sessions and cookies (local: .dev.vars; production: wrangler secret put BETTER_AUTH_SECRET)",
        "file": ".dev.vars",
        "set": true
      },
      {
        "name": "BETTER_AUTH_URL",
        "description": "Public origin of the app, used for redirects and trusted origins (a Worker var in production)",
        "file": ".dev.vars",
        "set": true
      }
    ],
    "nextSteps": [
      {
        "command": "pnpm install --no-frozen-lockfile",
        "cwd": "/home/me/projects/my-app"
      },
      {
        "command": "pnpm format",
        "cwd": "/home/me/projects/my-app"
      },
      {
        "command": "git add -A && git commit -m 'Initial commit'",
        "cwd": "/home/me/projects/my-app"
      },
      {
        "command": "docker compose up -d --wait",
        "note": "local Postgres",
        "cwd": "/home/me/projects/my-app"
      },
      {
        "command": "pnpm db:migrate",
        "cwd": "/home/me/projects/my-app"
      },
      {
        "command": "pnpm dev",
        "note": "http://localhost:5173",
        "longRunning": true,
        "cwd": "/home/me/projects/my-app"
      }
    ]
  }
}
```

### `Interrupted`

`--json` only: `create` was stopped (Ctrl-C, SIGTERM, a tool's timeout). Exit code `130`. `create` installs dependencies and can take a few minutes; give it at least five.

Fields: `written` (whether all files were written). When they were: `remaining` and the fields `SetupIncomplete` has (`directory`, `stack`, `command`, `files`, `env`, `nextSteps`). `fix`: The remaining setup, run in the project; `null` when it stopped while writing (delete the directory and run the same command again) or after the setup finished. Running the same command again gets `TargetNotEmpty` with the same `fix`.

Here, the run was stopped during `pnpm install`.

<!-- example: Interrupted -->

```sh
npx -y create-efforge create my-app --json
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "Interrupted",
    "message": "Stopped. my-app is only partly set up; to finish, run there: pnpm install --no-frozen-lockfile, then pnpm format, then git add -A && git commit -m 'Initial commit'",
    "fix": "cd my-app && pnpm install --no-frozen-lockfile && pnpm format && git add -A && git commit -m 'Initial commit'",
    "written": true,
    "remaining": [
      "pnpm install --no-frozen-lockfile",
      "pnpm format",
      "git add -A && git commit -m 'Initial commit'"
    ],
    "directory": "/home/me/projects/my-app",
    "stack": {
      "name": "my-app",
      "runtime": "cloudflare",
      "database": "postgres",
      "orm": "drizzle",
      "auth": "better-auth-orgs",
      "infra": "none",
      "ai": "none",
      "extras": []
    },
    "command": "npx -y create-efforge create my-app --yes",
    "files": [
      ".dev.vars",
      ".env.example",
      ".gitignore",
      "... 79 more"
    ],
    "env": [
      {
        "name": "DATABASE_URL",
        "description": "Used by `pnpm db:migrate` and drizzle-kit, read from the shell; unset, they use the docker-compose database. The running app connects through the HYPERDRIVE binding.",
        "file": ".dev.vars",
        "set": false
      },
      {
        "name": "BETTER_AUTH_SECRET",
        "description": "Signs sessions and cookies (local: .dev.vars; production: wrangler secret put BETTER_AUTH_SECRET)",
        "file": ".dev.vars",
        "set": true
      },
      {
        "name": "BETTER_AUTH_URL",
        "description": "Public origin of the app, used for redirects and trusted origins (a Worker var in production)",
        "file": ".dev.vars",
        "set": true
      }
    ],
    "nextSteps": [
      {
        "command": "pnpm install --no-frozen-lockfile",
        "cwd": "/home/me/projects/my-app"
      },
      {
        "command": "pnpm format",
        "cwd": "/home/me/projects/my-app"
      },
      {
        "command": "git add -A && git commit -m 'Initial commit'",
        "cwd": "/home/me/projects/my-app"
      },
      {
        "command": "docker compose up -d --wait",
        "note": "local Postgres",
        "cwd": "/home/me/projects/my-app"
      },
      {
        "command": "pnpm db:migrate",
        "cwd": "/home/me/projects/my-app"
      },
      {
        "command": "pnpm dev",
        "note": "http://localhost:5173",
        "longRunning": true,
        "cwd": "/home/me/projects/my-app"
      }
    ]
  }
}
```

### `WriteFailed`

The files couldn't be written (permissions, disk full).

Fields: `directory`. `fix`: None.

Here, the current directory is read-only.

<!-- example: WriteFailed -->

```sh
npx -y create-efforge create my-app --json
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "WriteFailed",
    "message": "Couldn't write /home/me/projects/readonly/my-app: PermissionDenied: FileSystem.makeDirectory (/home/me/projects/readonly/my-app)",
    "fix": null,
    "directory": "/home/me/projects/readonly/my-app"
  }
}
```

### `NotAnEfforgeProject`

`add` ran in a directory without `efforge.jsonc`, or the file isn't valid. `list --cwd` gets it only when the directory doesn't exist or its `efforge.jsonc` isn't valid; `list` in a directory without one succeeds with `project: false`.

Fields: `directory`, `reason`, and `project` when one was found nearby. `fix`: For `add`, when a parent directory, or exactly one child directory, is an efforge project: the same command with `--cwd` pointing at it; otherwise none. For `list`, the command without `--cwd`.

Here, run from `my-app/apps/web`, inside a project.

<!-- example: NotAnEfforgeProject -->

```sh
npx -y create-efforge add email --json
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "NotAnEfforgeProject",
    "message": "/home/me/projects/my-app/apps/web is not an efforge project (efforge.jsonc not found). Run this from the project root or pass --cwd.",
    "fix": "npx -y create-efforge add email --json --cwd=../..",
    "directory": "/home/me/projects/my-app/apps/web",
    "reason": "efforge.jsonc not found",
    "project": "/home/me/projects/my-app"
  }
}
```

### `NoAddonIds`

`add` got no add-on ids.

Fields: `available`: the ids the project can still add. `fix`: `list` for the same project.

Here, `my-app` has D1, Drizzle and Better Auth.

<!-- example: NoAddonIds -->

```sh
npx -y create-efforge add --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "NoAddonIds",
    "message": "Name the add-ons to add: infra/alchemy, ai/effect-ai-byok, extras/workflows, extras/realtime, extras/browser, extras/storage, extras/email. For example: npx create-efforge add infra/alchemy.",
    "fix": "npx -y create-efforge list --json --cwd=my-app",
    "available": [
      "infra/alchemy",
      "ai/effect-ai-byok",
      "extras/workflows",
      "extras/realtime",
      "extras/browser",
      "extras/storage",
      "extras/email"
    ]
  }
}
```

### `UnknownAddon`

An id that names no add-on, or more than one (`auth`).

Fields: `id`, `suggestions` (full ids: every id a fragment of three or more letters starts, like `auth` or `stor`, else the one id it is a clear typo of), `addons` (every add-on id). `fix`: With exactly one suggestion, the command using it; otherwise `null`. Run `npx -y create-efforge list --json --cwd <project>` to see which ids the project can still add, and if what you want isn't there, efforge doesn't offer it.

Here, `my-app` has D1, Drizzle and Better Auth.

<!-- example: UnknownAddon -->

```sh
npx -y create-efforge add emial --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "UnknownAddon",
    "message": "\"emial\" is not an add-on. Did you mean extras/email? See which ones this project can add with npx create-efforge list --json.",
    "fix": "npx -y create-efforge add extras/email --json --cwd my-app",
    "id": "emial",
    "suggestions": [
      "extras/email"
    ],
    "addons": [
      "runtime/cloudflare",
      "database/postgres",
      "database/d1",
      "... 11 more"
    ]
  }
}
```

### `SlotAlreadySet`

The project already has another value for a single-choice slot. `add` only moves a slot from `none` to a value.

Fields: `slot`, `current`, `value`. `fix`: None: create a new project for a different choice.

Here, `my-app` has D1, Drizzle and Better Auth.

<!-- example: SlotAlreadySet -->

```sh
npx -y create-efforge add database/postgres --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "SlotAlreadySet",
    "message": "Can't add database/postgres: database is already \"d1\", and swapping an existing choice isn't supported yet. Create a new project to use a different database.",
    "fix": null,
    "slot": "database",
    "current": "d1",
    "value": "postgres"
  }
}
```

### `RemoveNotSupported`

An id ending in `/none`: removing an add-on isn't supported yet.

Fields: `id`. `fix`: None.

Here, `my-app` has D1, Drizzle and Better Auth.

<!-- example: RemoveNotSupported -->

```sh
npx -y create-efforge add auth/none --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "RemoveNotSupported",
    "message": "Removing an add-on isn't supported yet (\"auth/none\").",
    "fix": null,
    "id": "auth/none"
  }
}
```

### `OverlayConflict`

`add` would replace files you changed since efforge wrote them. Nothing was written.

Fields: `files`, `diff` (unified diff: yours, then efforge's). `fix`: The command with `--overwrite`. That replaces `files` and loses your changes to them; look at `diff` first, or commit and merge by hand afterwards.

Here, `my-app` has D1 and Effect SQL, no auth, and its dashboard (`apps/web/src/routes/app/index.tsx`) was edited.

<!-- example: OverlayConflict -->

```sh
npx -y create-efforge add auth/better-auth --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "OverlayConflict",
    "message": "You've edited apps/web/src/routes/app/index.tsx since it was generated. Nothing was written. Re-run with --overwrite to replace it (your edits are lost), or commit first and merge by hand.",
    "fix": "npx -y create-efforge add auth/better-auth --json --cwd my-app --overwrite",
    "files": [
      "apps/web/src/routes/app/index.tsx"
    ],
    "diff": "--- apps/web/src/routes/app/index.tsx (on disk)\n+++ apps/web/src/routes/app/index.tsx (efforge)\n@@ -2,23 +2,27 @@\n import { Card, CardContent, CardDescription, CardHeader, CardTitle } from \"@/components/ui/card\"\n import { widgets } from \"@/components/widgets\"\n import { getGreeting } from \"@/server/greeting\"\n-import { listMy notes } from \"@/server/notes\"\n+import { listNotes } from \"@/server/notes\"\n \n export const Route = createFileRoute(\"/app/\")({\n-  loader: async () => ({ greeting: await getGreeting(), notes: await listMy notes() }),\n+  loader: async () => ({ greeting: await getGreeting(), notes: await listNotes() }),\n   component: Dashboard,\n })\n \n function Dashboard() {\n+  const { session } = Route.useRouteContext()\n   const { greeting, notes } = Route.useLoaderData()\n   return (\n     <div className=\"space-y-6\">\n       <h1 className=\"text-2xl font-semibold\">Dashboard</h1>\n       <Card>\n         <CardHeader>\n-          <CardTitle>{greeting}</CardTitle>\n+          <CardTitle>\n+            {greeting}, {session.name}\n+          </CardTitle>\n           <CardDescription>\n-            This text came from a server function running an Effect on the app runtime.\n+            This text came from a server function running an Effect on the app runtime. You are\n+            signed in as {session.email}.\n           </CardDescription>\n         </CardHeader>\n       </Card>\n"
  }
}
```

### `TransformAnchorMissing`

`add` edits shared files (layers, exports, bindings) in place and couldn't find where in one you changed. Nothing was written.

Fields: `file`, `anchor`, `snippet` (what to add by hand). `fix`: None: apply `snippet` and run the command again.

Here, `apps/web/src/server/layers.ts` was rewritten without its `Layer.mergeAll(...)`.

<!-- example: TransformAnchorMissing -->

```sh
npx -y create-efforge add email --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "TransformAnchorMissing",
    "message": "Couldn't find AppLayer = Layer.mergeAll(...) in apps/web/src/server/layers.ts. Nothing was written. Add the snippet by hand, then re-run.",
    "fix": null,
    "file": "apps/web/src/server/layers.ts",
    "anchor": "AppLayer = Layer.mergeAll(...)",
    "snippet": "In apps/web/src/server/layers.ts:\n  import { MailerLive } from \"./mailer\"\n  export const AppLayer = Layer.mergeAll(/* ... */ MailerLive)"
  }
}
```

### `CommandFailed`

`add` wrote its files, then a command it runs failed (`pnpm install`).

Fields: `failed`, `output` (last 15 lines), and what the success document would have carried: `directory`, `stack`, `added`, `created`, `changed`, `removed`, `notes`, `env` and `nextSteps` (the failed command first). `fix`: The failed command, in the project. Running the same `add` again runs the install it still owes (or, with `--no-install`, puts it first in `nextSteps` and says so in `warnings`) instead of reporting nothing to do.

Here, the project was installed before, and `pnpm install` fails.

<!-- example: CommandFailed -->

```sh
npx -y create-efforge add ai --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "CommandFailed",
    "message": "`pnpm install --no-frozen-lockfile` failed. The files were written; run it yourself, then the rest of nextSteps.",
    "fix": "cd my-app && pnpm install --no-frozen-lockfile",
    "failed": "pnpm install --no-frozen-lockfile",
    "output": "ERR_PNPM_META_FETCH_FAIL  GET https://registry.npmjs.org/@effect%2Fai-openai: request to registry.npmjs.org failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org",
    "directory": "/home/me/projects/my-app",
    "stack": {
      "name": "my-app",
      "runtime": "cloudflare",
      "database": "d1",
      "orm": "drizzle",
      "auth": "better-auth",
      "infra": "none",
      "ai": "effect-ai-byok",
      "extras": []
    },
    "added": [
      {
        "id": "ai/effect-ai-byok",
        "title": "Effect AI (bring your own key)"
      }
    ],
    "created": [
      "apps/web/src/server/ai.ts",
      "apps/web/src/server/llm-provider.ts",
      "apps/web/src/server/llm.ts",
      "packages/core/src/llm.ts"
    ],
    "changed": [
      ".dev.vars",
      ".env.example",
      "AGENTS.md",
      "apps/web/package.json",
      "apps/web/src/server/layers.ts",
      "efforge.jsonc",
      "packages/core/src/index.ts",
      "pnpm-workspace.yaml"
    ],
    "removed": [],
    "notes": [],
    "env": [
      {
        "name": "LLM_PROVIDER",
        "description": "anthropic | openai | openrouter | ollama",
        "file": ".dev.vars",
        "set": true
      },
      {
        "name": "LLM_MODEL",
        "description": "Model id for the provider",
        "file": ".dev.vars",
        "set": true
      },
      {
        "name": "LLM_API_KEY",
        "description": "Provider API key (not needed for a local Ollama); a Worker secret in production",
        "file": ".dev.vars",
        "set": false
      },
      {
        "name": "LLM_BASE_URL",
        "description": "Optional OpenAI-compatible endpoint (openai, ollama)",
        "file": ".dev.vars",
        "set": false
      }
    ],
    "nextSteps": [
      {
        "command": "pnpm install --no-frozen-lockfile",
        "cwd": "/home/me/projects/my-app"
      }
    ]
  }
}
```

### `InternalError`

A bug in efforge or a broken install (the example points efforge at templates that don't exist). Please report it with the output.

Fields: `cause`. `fix`: None.

<!-- example: InternalError -->

```sh
npx -y create-efforge list --json
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "InternalError",
    "message": "NotFound: FileSystem.readDirectory (/nonexistent/templates) (AddonLoadError). This is a bug in efforge or a broken install; please report it at https://github.com/amagdy46/efforge/issues.",
    "fix": null,
    "cause": "AddonLoadError"
  }
}
```

## In a pipe, without `--json`

Without `--json`, output is for people and may change. One rule holds anyway: when stdout is not a terminal, it carries only what the command is for. `create` and `add` start with one plain line naming the version, then print their steps one line each, without spinners; `list` prints the list and nothing before it. Errors go to stderr, followed by `Try: <command>` when there is a fix.
