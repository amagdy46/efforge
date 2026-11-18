# `--json`: the contract for scripts and coding agents

`create`, `add` and `list` take `--json`. With it, a run prints exactly one JSON document on stdout and nothing else, whether it succeeds or fails. Nothing goes to stderr either, except what a child process prints when it crashes outright. Progress is not printed; warnings and skipped steps go into the document. `--json` never prompts: on `create` it implies `--yes`.

This page is the contract. Every example on it is the real output of the command above it, checked by `test/json-docs.test.ts` (paths shortened to `/home/me/projects`, long `files` and `addons` lists cut to their first three items) and matches its schema. JSON Schemas for the documents ship in the package under `schemas/` ([create](../schemas/create.schema.json), [add](../schemas/add.schema.json), [list](../schemas/list.schema.json), [error](../schemas/error.schema.json)).

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

A `fix` is either a command that does what you were trying to do, or `null` with the facts you need to decide (allowed values, add-on ids, paths, and for a conflict `alternatives`). Every fix is built in one place (`src/fix.ts`), which checks it against what you ran before printing it, and `test/fix-property.test.ts` runs hundreds of generated invocations and follows their fixes to hold it to these rules:

- It is your own command with the smallest change that gets past the error. It keeps the command, the project name or add-on ids, and your flags (`--json`, `--dry-run`, `--no-install`, `--no-git`, `--cwd`). The command comes first, and any flag it adds goes before a `--`. It may start with `cd <dir> &&`.
- A fix for `add`, `list`, or anything that isn't a create never creates a project. A fix for a create keeps its name; the only change it makes to one is lower case and hyphens for spaces (`My App` becomes `my-app`). A path (`../app`, `a/b`) is never turned into a name.
- Only an error about a stack value or an add-on id suggests a different value, and only when what you typed is a clear typo of exactly one valid value. The rule: an option of one or two characters (`d1`) is only matched exactly; otherwise one edit (a swap of two neighbouring letters counts as one) for options up to six characters, two for longer ones. Add-on ids also take a fragment of three or more letters that starts exactly one id (`stor`). `--database=postgress` gets `--database=postgres`; `--database=mysql`, `--database=d2` and `add stripe` get `fix: null`, with `allowed` or `addons` to choose from. A flag name follows the same rule (`--databse`).
- When there is more than one way out (`--database=none --auth=better-auth`, or `add auth/better-auth` on a project without a database), `fix` is `null` and `alternatives` lists each way out as a complete command with a one-line `description`. Pick one; efforge doesn't pick a database or drop a choice for you.
- Setup steps (`pnpm install`, `pnpm format`, the initial commit) are offered only for the project your command would have made, and never one you turned off with `--no-install` or `--no-git`.
- A fix never repeats the command you ran, and following fixes never loops or grows a command.
- It starts with `npx -y create-efforge`. `-y` keeps npx from asking before a download. If you ran a pinned version (`create-efforge@0.3.0`) or `@latest`, run the fix with the same package spec, or npx may run a different cached version.
- A `create` that would prompt gets `--yes`.

## Exit codes

| Code | |
|---|---|
| `0` | Success. Also answering No at the confirmation prompt (never under `--json`). |
| `1` | Any error, including a mistyped flag. With `--json`, the document says which. |
| `130` | Stopped: Ctrl-C, SIGTERM, or a tool's timeout. With `--json`, `create` and `add` print an [`Interrupted`](#interrupted) document saying what was written and how to finish. |

A signal in the first fraction of a second, before efforge has started, can end the run with no document and exit `130` (SIGINT) or `143` (SIGTERM). Nothing has been written at that point; run the same command again.

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
    ".gitignore"
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
      "description": "Public origin of the deployed app, used for redirects and trusted origins (a Worker var). When unset, the origin comes from each request (under pnpm dev, localhost on any port).",
      "file": ".dev.vars",
      "set": false
    }
  ],
  "nextSteps": [
    {
      "command": "pnpm db:migrate",
      "note": "create the tables in the local D1",
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
    ".gitignore"
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
      "description": "Public origin of the deployed app, used for redirects and trusted origins (a Worker var). When unset, the origin comes from each request (under pnpm dev, localhost on any port).",
      "file": ".dev.vars",
      "set": false
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

`stack` is the project's stack afterwards. `added` has one entry per add-on this run added: its `id`, `title`, `docs` (its page in efforge's docs), `card` (its dashboard card module, when the project has one) and `agents` (the headings of the `AGENTS.md` sections this run added for it). `created` and `changed` are the files this run created and changed, `removed` the generated files it deleted (`wrangler.jsonc` when you add Alchemy), `skipped` the ids the project already had and files already as efforge would write them. `replacedScripts` names package scripts an add-on replaced. `packageManager` is `{from, to}` when `add` raised the root `packageManager` (projects made by efforge 0.2.0, whose pnpm ignored the Effect overrides), else `null`. `notes` are things left to do by hand, one line each (for example, the widgets line to add to a dashboard you edited). `installed` says whether `pnpm install` ran in this run; when it didn't and should, `nextSteps` starts with it. `env` lists only the env vars this run added.

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
      "title": "Email",
      "docs": "https://github.com/amagdy46/efforge/blob/main/docs/addons/extras-email.md",
      "agents": [
        "Email"
      ]
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
    "README.md",
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
      "title": "Effect AI (bring your own key)",
      "docs": "https://github.com/amagdy46/efforge/blob/main/docs/addons/ai-effect-ai-byok.md",
      "agents": [
        "AI (Effect AI, bring your own key)"
      ]
    },
    {
      "id": "extras/storage",
      "title": "Storage",
      "docs": "https://github.com/amagdy46/efforge/blob/main/docs/addons/extras-storage.md",
      "agents": [
        "Storage"
      ]
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
    "README.md",
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

`addons` has every add-on you can pick or add: `id` is what `add` takes. In an efforge project's root (or with `--cwd` pointing at it), `project` is `true`, the document has the project's `directory` and `stack`, and each add-on has `installed`. Elsewhere `project` is `false`, as `add` would see it; when the directory is inside a project (`my-app/apps/web`) or holds exactly one, `nearby` is that project's path, to pass as `--cwd`.

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
    }
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
    }
  ]
}
```

## Error codes

### `UnknownFlag`

A flag efforge doesn't have.

Fields: `flag` (as typed), `suggestions` (closest flags). `fix`: The command with the flag corrected when it is a clear typo of one (the rule above); without it when it repeats a flag you also passed (`--jsn --json`); with the command first when a flag came before it (`--cwd my-app list`); otherwise `null`, since dropping a flag you asked for would do something else.

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

Fields: `flag`, `value`, `expected`, and `allowed` when the flag takes a list of values (a stack flag, `--log-level`, `--completions`, an on/off flag). `fix`: `null`: which value you meant is your choice, and leaving the flag out would do something else.

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

The root form (`npx -y create-efforge <name>`) creates a project, so efforge refuses a first word that doesn't look like a name: a command in other case (`Add`, `CREATE`) or a typo of one (`lst`, `ad`, `crate`, by the rule above), a word people and agents guess as a command (`help`, `version`, `update`, `upgrade`, `remove`, `rm`, `uninstall`, `delete`, `install`, `init`, `new`, `ls`, `show`, `status`, `info`, `doctor`, `graph`, `run`, `dev`, `start`, `build`, `check`, `lint`, `test`, `deploy`, `publish`, `migrate`, `generate`, `config`, `login`, `logout`; the list is `reservedWords` in `src/fix.ts`) or a typo of a long one (`hlep`), more than one word (`remove email`), or one word with a flag only `add` and `list` take (`foo --cwd my-app`). This check runs before anything else, so a mistyped `add email --cwd my-app` is reported as the mistyped command, not as a create with a stray `--cwd`.

Fields: `command` (as typed), `suggestion` (when it names a real command), `commands`, and `arguments` or `flag` when those were the reason. `fix`: The command it names, written out and first, keeping every argument and flag; otherwise `null`. To really name a project `lst`, `update` or `help`, run `npx -y create-efforge create lst`.

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

### `InsideProject`

The root form (no `create`) ran inside an efforge project: the current directory or a parent has an `efforge.jsonc`. That is where `add` and `list` are run, and a project nested in another is almost never meant, so efforge refuses before anything else. `create <name>` still creates one there.

Fields: `project` (the project's directory), `name` (the word you gave, if any), `commands`. `fix`: None. To add to the project, run `add`; to create a project inside it anyway, run `npx -y create-efforge create <name>`.

Here, run in `my-app`.

<!-- example: InsideProject -->

```sh
npx -y create-efforge app2 --json
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "InsideProject",
    "message": "This is inside the efforge project /home/me/projects/my-app, so efforge doesn't create a project here without the word create. The commands are create, add, list. To add to this project, run npx -y create-efforge add <id>; to create a project inside it anyway, run npx -y create-efforge create app2.",
    "fix": null,
    "project": "/home/me/projects/my-app",
    "name": "app2",
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

Each way out drops or swaps a choice you made, or makes one you didn't (which database, which ORM: `add` can't swap them later). So `fix` is `null`, and the error lists the ways out for you to choose from.

Fields: `flag` and `value` (create) or `slot` and `value` (add), `allowed` (the values that slot can take as things stand), `reason`, and `alternatives`: every way out, each `{ command, description }`, where `command` is your command with one change, complete and non-interactive. For `create`, a way out is one flag changed (another value for either side of the conflict, or an extra left out). For `add`, it is your command with the smallest set of add-ons added that satisfies the rules. `add` also has `needs`: the slots that must be filled in the same command, each `{ slot, options }` with the ids that can fill it. `fix`: None. Pick one of `alternatives` (or ask the user which), and run it.

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
    "message": "--auth=better-auth can't be used here: auth stores users in the database, and the database is none. Change one of the two; alternatives lists the commands.",
    "fix": null,
    "flag": "--auth",
    "value": "better-auth",
    "allowed": [
      "none"
    ],
    "reason": "auth stores users in the database, and the database is none",
    "alternatives": [
      {
        "command": "npx -y create-efforge create my-app --json --database=postgres --auth=better-auth",
        "description": "Use --database=postgres instead of --database=none"
      },
      {
        "command": "npx -y create-efforge create my-app --json --database=d1 --auth=better-auth",
        "description": "Use --database=d1 instead of --database=none"
      },
      {
        "command": "npx -y create-efforge create my-app --json --database=none --auth=none",
        "description": "Use --auth=none instead of --auth=better-auth"
      }
    ]
  }
}
```

For `add`: here, `my-app` was created with `--database=none`.

<!-- example: IncompatibleStack-add -->

```sh
npx -y create-efforge add auth/better-auth --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "IncompatibleStack",
    "message": "Can't add auth/better-auth: auth needs a database, and this project has none. Add one in the same command (alternatives lists the ways).",
    "fix": null,
    "slot": "auth",
    "value": "better-auth",
    "allowed": [
      "none"
    ],
    "needs": [
      {
        "slot": "database",
        "options": [
          "database/postgres",
          "database/d1"
        ]
      },
      {
        "slot": "orm",
        "options": [
          "orm/drizzle",
          "orm/effect-sql"
        ]
      }
    ],
    "alternatives": [
      {
        "command": "npx -y create-efforge add database/postgres orm/drizzle auth/better-auth --json --cwd my-app",
        "description": "Add database/postgres and orm/drizzle with it"
      },
      {
        "command": "npx -y create-efforge add database/postgres orm/effect-sql auth/better-auth --json --cwd my-app",
        "description": "Add database/postgres and orm/effect-sql with it"
      },
      {
        "command": "npx -y create-efforge add database/d1 orm/drizzle auth/better-auth --json --cwd my-app",
        "description": "Add database/d1 and orm/drizzle with it"
      },
      {
        "command": "npx -y create-efforge add database/d1 orm/effect-sql auth/better-auth --json --cwd my-app",
        "description": "Add database/d1 and orm/effect-sql with it"
      }
    ],
    "reason": "auth needs a database, and this project has none. Add one in the same command (alternatives lists the ways)"
  }
}
```

### `InvalidProjectName`

The name isn't a valid npm package name, or is a path.

Fields: `name`, and `suggestion` when the name differs from a valid one only by case and spaces. `fix`: The command with that name (`My App` becomes `my-app`); otherwise `null`. A path (`../app`, `apps/web`) is never turned into a name: the project goes in `./<name>`, so run efforge from the directory it should go in (`cd ..` first) and pass just the name.

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
    "message": "\"My App\" isn't a valid npm package name: use lowercase letters, digits, - . _ ~ (optionally @scope/name). Did you mean my-app?",
    "fix": "npx -y create-efforge create my-app --json",
    "name": "My App",
    "suggestion": "my-app"
  }
}
```

### `TargetNotEmpty`

The project directory exists and has files in it (a directory holding only `.git` counts as empty). Nothing was written. `fix` never proposes another name: an agent retrying after a timeout would end with two projects.

Fields: `directory`, `project` (whether it holds an efforge project). When it does: `stack` (the project's), `requested` (the stack this command asked for), `remaining` (setup steps that never ran: install and format when `node_modules` has no completed install, the commit when the repo has none) and `nextSteps` (those, then the usual steps for the stack). `fix`: Only when `stack` is `requested` (it is the project this command would have made, typically a retry after a stop): the remaining steps, run in the project, without any you turned off with `--no-install` or `--no-git`. Otherwise `null`: use the project as it is, or pick another name.

Here, `./my-app` holds a D1 project with Better Auth whose install never ran, and the command asks for the same stack.

<!-- example: TargetNotEmpty -->

```sh
npx -y create-efforge create my-app --json --database=d1 --auth=better-auth
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "TargetNotEmpty",
    "message": "/home/me/projects/my-app already holds an efforge project with this stack, and its setup didn't finish. To finish it, run there: pnpm install --no-frozen-lockfile, then pnpm format. Or pick another name.",
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
    "requested": {
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
        "note": "create the tables in the local D1",
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
      ".gitignore"
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
        "description": "Public origin of the deployed app, used for redirects and trusted origins (a Worker var). When unset, the origin comes from each request (under pnpm dev, localhost on any port).",
        "file": ".dev.vars",
        "set": false
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
        "note": "create the tables",
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
}
```

### `Interrupted`

`--json` only: `create` or `add` was stopped (Ctrl-C, SIGTERM, a tool's timeout). Exit code `130`. `create` installs dependencies and can take a few minutes; give it at least five.

Fields: `written` (whether files were written). For `create`, when they were: `remaining` and the fields `SetupIncomplete` has (`directory`, `stack`, `command`, `files`, `env`, `nextSteps`, `warnings`). `fix`: The remaining setup, run in the project; `null` when it stopped while writing (delete the directory and run the same command again) or after the setup finished. Running the same command again gets `TargetNotEmpty` with the same `fix`.

For `add`: stopped before writing, `written` is `false` and nothing changed; run the same command again. Stopped while writing, `written` is `true`, `fix` is `null`, and running the same command again finishes what it can (see `git status` first). Stopped during the install, `remaining` is the install and the document has the fields `CommandFailed` has (`directory`, `stack`, `added`, `created`, `changed`, `env`, `nextSteps`, ...); `fix` runs the install.

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
      ".gitignore"
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
        "description": "Public origin of the deployed app, used for redirects and trusted origins (a Worker var). When unset, the origin comes from each request (under pnpm dev, localhost on any port).",
        "file": ".dev.vars",
        "set": false
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
        "note": "create the tables",
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

`add` ran in a directory without `efforge.jsonc`, or the file isn't valid. `list --cwd` gets it only when the directory doesn't exist, isn't a directory, or its `efforge.jsonc` isn't valid; `list` in a directory without one succeeds with `project: false` (and `nearby`).

Fields: `directory`, `reason`, and `project` when one was found nearby. `fix`: When a parent directory, or exactly one child directory, is an efforge project (also when `--cwd` names a file in one): the same command with `--cwd` pointing at it; otherwise none.

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
    "message": "Name the add-ons to add: infra/alchemy, ai/effect-ai-byok, extras/workflows, extras/realtime, extras/browser, extras/storage, extras/email.",
    "fix": "npx -y create-efforge list --json --cwd my-app",
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
    "message": "\"emial\" is not an add-on. Did you mean extras/email? See which ones this project can add: npx -y create-efforge list --json --cwd my-app",
    "fix": "npx -y create-efforge add extras/email --json --cwd my-app",
    "id": "emial",
    "suggestions": [
      "extras/email"
    ],
    "addons": [
      "runtime/cloudflare",
      "database/postgres",
      "database/d1"
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

Here, `my-app` has D1 and Effect SQL, no auth, and its `/app` layout (`apps/web/src/routes/app.tsx`), which auth replaces, was edited.

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
    "message": "You've edited apps/web/src/routes/app.tsx since it was generated. Nothing was written. Re-run with --overwrite to replace it (your edits are lost), or commit first and merge by hand.",
    "fix": "npx -y create-efforge add auth/better-auth --json --cwd my-app --overwrite",
    "files": [
      "apps/web/src/routes/app.tsx"
    ],
    "diff": "--- apps/web/src/routes/app.tsx (on disk)\n+++ apps/web/src/routes/app.tsx (efforge)\n@@ -1,13 +1,22 @@\n-import { createFileRoute, Outlet } from \"@tanstack/react-router\"\n+import { createFileRoute, Outlet, redirect } from \"@tanstack/react-router\"\n import { AppShell } from \"@/components/app-shell\"\n+import { UserMenu } from \"@/components/user-menu\"\n+import { getSession } from \"@/server/session\"\n \n-export const Route = createFileRoute(\"/app\")({ component: AppLayout })\n+export const Route = createFileRoute(\"/app\")({\n+  beforeLoad: async () => {\n+    const session = await getSession()\n+    if (session === null) throw redirect({ to: \"/sign-in\" })\n+    return { session }\n+  },\n+  component: AppLayout,\n+})\n \n function AppLayout() {\n+  const { session } = Route.useRouteContext()\n   return (\n-    <AppShell>\n+    <AppShell account={<UserMenu name={session.name} email={session.email} />}>\n       <Outlet />\n     </AppShell>\n   )\n }\n-// signed-in pages share this layout\n"
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

Fields: `failed`, `output` (last 15 lines), and what the success document would have carried: `directory`, `stack`, `added`, `created`, `changed`, `removed`, `notes`, `env` and `nextSteps` (the failed command first). `fix`: The failed command, in the project. Whether an install is owed is read from the project itself: what its `package.json` files and `pnpm-workspace.yaml` declare against what pnpm recorded as installed (`node_modules/.pnpm/lock.yaml`). So running the `fix` by hand settles it, and the next `add` runs an install still owed (or, with `--no-install` or `--dry-run`, puts it first in `nextSteps` and says so in `warnings`) instead of reporting nothing to do.

Here, `pnpm install` fails.

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
        "title": "Effect AI (bring your own key)",
        "docs": "https://github.com/amagdy46/efforge/blob/main/docs/addons/ai-effect-ai-byok.md",
        "agents": [
          "AI (Effect AI, bring your own key)"
        ]
      }
    ],
    "skipped": [],
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
      "README.md",
      "apps/web/package.json",
      "apps/web/src/server/layers.ts",
      "efforge.jsonc",
      "packages/core/src/index.ts",
      "pnpm-workspace.yaml"
    ],
    "removed": [],
    "replacedScripts": [],
    "packageManager": null,
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
    ],
    "warnings": []
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
