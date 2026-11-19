# `--json`: the contract for scripts and coding agents

`create`, `add`, `list`, `info`, `graph`, `upgrade` and `doctor` take `--json`. With it, a run prints exactly one JSON document on stdout and nothing else, whether it succeeds or fails. Nothing goes to stderr either, except what a child process prints when it crashes outright. Progress is not printed; warnings and skipped steps go into the document. `--json` never prompts: on `create` it implies `--yes`.

This page is the contract. Every example on it is the real output of the command above it, checked by `test/json-docs.test.ts` (paths shortened to `/home/me/projects`, long `files` and `addons` lists cut to their first three items) and matches its schema. JSON Schemas for the documents ship in the package under `schemas/` ([create](../schemas/create.schema.json), [add](../schemas/add.schema.json), [list](../schemas/list.schema.json), [info](../schemas/info.schema.json), [graph](../schemas/graph.schema.json), [error](../schemas/error.schema.json)).

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
| `2` | Something breaks the project: `upgrade --check` found `needs-action`, `upgrade` left something only you can fix, or a `doctor` check failed. The command itself worked: under `--json` the document has `ok: true`, and `status` says what it found. CI can gate on it. |
| `3` | `upgrade --check --strict` only: nothing breaks, and `upgrade` has something to apply (`behind`). |
| `130` | Stopped: Ctrl-C, SIGTERM, or a tool's timeout. With `--json`, `create` and `add` print an [`Interrupted`](#interrupted) document saying what was written and how to finish. |

A signal in the first fraction of a second, before efforge has started, can end the run with no document and exit `130` (SIGINT) or `143` (SIGTERM). Nothing has been written at that point; run the same command again.

## Not part of the contract

The flags every command gets from the CLI library behave the same with or without a terminal, and none of them prompts:

| Flag | What it does |
|---|---|
| `--help`, `-h` | Prints the help for the command as text on stdout and exits `0`, with or without `--json`. |
| `--version`, `-v` | Prints `create-efforge v<version>` and exits `0`. With `--json` it prints the envelope alone (`{ efforge, contract, ok: true }`), which is the cheapest way to check which CLI and contract you have. |
| `--completions <shell>` | Prints a completion script for `bash`, `zsh`, `fish` or `powershell` as text and exits `0`, with or without `--json`. |
| `--log-level <level>` | Accepted by every command and changes nothing efforge prints: efforge logs nothing. Any other value is an `InvalidFlagValue` error. |

The library's `--wizard` is not one of efforge's flags (efforge's own prompts do its job): it is an `UnknownFlag` error with `fix: null`.

## `create`

`directory` is absolute. `files` lists everything written, sorted. With `--preset`, `stack` is what the preset chose (with any stack flag you gave over it), and `command` gives it as flags, one for each part that differs from the default: a preset's contents can change between versions, so nothing records its name. `installed` says whether `pnpm install` ran; `git` is `committed`, `initialized` (git init worked, the commit didn't) or `skipped`. `command` recreates the same stack without prompts.

`env` lists every env var the project reads: `file` is where the local value lives (`.dev.vars`, or `.env` with Alchemy) and `set` says whether efforge wrote a value there that works locally. When `set` is false (an API key only you have), efforge wrote it empty, in `file` and in `.env.example`, and the feature that reads it fails until it is filled in. `secret` says the value is a secret (a key, a password, a signing secret): the deployed value is set with `wrangler secret put` or the deploy env, and is never printed or committed. A secret can still have a local value (`BETTER_AUTH_SECRET` does: `secret: true`, `set: true`). These two fields mean the same in `create`, `add` and `info`.

`nextSteps` are the commands still to run, in order, each with the directory to run it in (`cwd`). `pnpm db:migrate` is in them while it is owed: on D1, while the local database lacks a migration (what `doctor`'s `migrations` check reads), in `add`, `upgrade` and an `Interrupted` document too; on Postgres, which can't be read without connecting, when the run writes a migration. A step with `longRunning: true` (the dev server) doesn't exit on its own: start it in the background or leave it to the user.

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
      "description": "Signs sessions and cookies (production: a Worker secret, `wrangler secret put BETTER_AUTH_SECRET` or the deploy env with Alchemy)",
      "file": ".dev.vars",
      "set": true,
      "secret": true
    },
    {
      "name": "BETTER_AUTH_URL",
      "description": "Public origin of the deployed app, used for redirects and trusted origins (a Worker var). When unset, the origin comes from each request (under pnpm dev, localhost on any port).",
      "file": ".dev.vars",
      "set": true,
      "secret": false
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

When the project has no repository of its own (`--no-git`, or `git init` failed) and git ignores it (a `.gitignore` above it with `*`), `warnings` says so, with the rule and `git init` to run in the project: without it `pnpm check` sees no files and Tailwind styles nothing.

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
      "set": true,
      "secret": true
    },
    {
      "name": "BETTER_AUTH_SECRET",
      "description": "Signs sessions and cookies (production: a Worker secret, `wrangler secret put BETTER_AUTH_SECRET` or the deploy env with Alchemy)",
      "file": ".dev.vars",
      "set": true,
      "secret": true
    },
    {
      "name": "BETTER_AUTH_URL",
      "description": "Public origin of the deployed app, used for redirects and trusted origins (a Worker var). When unset, the origin comes from each request (under pnpm dev, localhost on any port).",
      "file": ".dev.vars",
      "set": true,
      "secret": false
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

`stack` is the project's stack afterwards. `added` has one entry per add-on this run added: its `id`, `title`, `docs` (its page in efforge's docs), `card` (its dashboard card module, when the project has one) and `agents` (the headings of the `AGENTS.md` sections this run added for it). `created` and `changed` are the files this run created and changed, `removed` the generated files it deleted (`wrangler.jsonc` when you add Alchemy), `skipped` the ids the project already had and files already as efforge would write them. `replacedScripts` names package scripts an add-on replaced. `packageManager` is `{from, to}` when `add` raised the root `packageManager` (projects made by efforge 0.2.0, whose pnpm ignored the Effect overrides), else `null`. `notes` are things left to do by hand, one line each (for example, a card left out of a project with no dashboard registry, a server function `add` could not put `requireSession` on, with the fix, or, when auth is added, that every server function now requires a session, which of the project's own `pnpm check` now fails on, how to make one public, and what changed for routes under `/api/` and outside it). `installed` says whether `pnpm install` ran in this run; when it didn't and should, `nextSteps` starts with it. `env` lists only the env vars this run added.

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
      "card": "apps/web/src/capabilities/email.tsx",
      "agents": [
        "Email"
      ]
    }
  ],
  "skipped": [],
  "created": [
    "apps/web/src/capabilities/email.tsx",
    "apps/web/src/server/email-demo.ts",
    "apps/web/src/server/mailer.ts",
    "packages/core/src/mailer.ts",
    "packages/core/test/mailer-in-memory.ts",
    "packages/core/test/mailer.test.ts"
  ],
  "changed": [
    ".dev.vars",
    ".env.example",
    "AGENTS.md",
    "README.md",
    "apps/web/src/capabilities/registry.ts",
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
      "set": true,
      "secret": false
    },
    {
      "name": "MAIL_TRANSPORT",
      "description": "cloudflare (default) sends through the EMAIL binding; console prints emails instead (the local value)",
      "file": ".dev.vars",
      "set": true,
      "secret": false
    }
  ],
  "nextSteps": [
    {
      "command": "pnpm install --no-frozen-lockfile",
      "cwd": "/home/me/projects/my-app"
    },
    {
      "command": "pnpm db:migrate",
      "note": "create the tables in the local D1",
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
      "card": "apps/web/src/capabilities/ai.tsx",
      "agents": [
        "AI (Effect AI, bring your own key)"
      ]
    },
    {
      "id": "extras/storage",
      "title": "Storage",
      "docs": "https://github.com/amagdy46/efforge/blob/main/docs/addons/extras-storage.md",
      "card": "apps/web/src/capabilities/storage.tsx",
      "agents": [
        "Storage"
      ]
    }
  ],
  "skipped": [],
  "created": [
    "apps/web/src/capabilities/ai.tsx",
    "apps/web/src/capabilities/storage.tsx",
    "apps/web/src/server/ai-demo.ts",
    "apps/web/src/server/ai.ts",
    "apps/web/src/server/llm-provider.ts",
    "apps/web/src/server/llm.ts",
    "apps/web/src/server/storage-demo.ts",
    "apps/web/src/server/storage-route.ts",
    "apps/web/src/server/storage.ts",
    "packages/core/src/llm.ts",
    "packages/core/src/storage-security.ts",
    "packages/core/src/storage.ts",
    "packages/core/test/llm-fixed.ts",
    "packages/core/test/llm.test.ts",
    "packages/core/test/storage-in-memory.ts",
    "packages/core/test/storage-security.test.ts",
    "packages/core/test/storage.test.ts"
  ],
  "changed": [
    ".dev.vars",
    ".env.example",
    "AGENTS.md",
    "README.md",
    "apps/web/package.json",
    "apps/web/src/capabilities/registry.ts",
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
      "set": true,
      "secret": false
    },
    {
      "name": "LLM_MODEL",
      "description": "Model id for the provider",
      "file": ".dev.vars",
      "set": true,
      "secret": false
    },
    {
      "name": "LLM_API_KEY",
      "description": "Provider API key (not needed for a local Ollama); a Worker secret in production",
      "file": ".dev.vars",
      "set": false,
      "secret": true
    },
    {
      "name": "LLM_BASE_URL",
      "description": "Optional OpenAI-compatible endpoint (openai, ollama)",
      "file": ".dev.vars",
      "set": true,
      "secret": false
    },
    {
      "name": "STORAGE_SIGNING_SECRET",
      "description": "HMAC secret for signed download URLs (production: a Worker secret, `wrangler secret put STORAGE_SIGNING_SECRET` or the deploy env with Alchemy)",
      "file": ".dev.vars",
      "set": true,
      "secret": true
    }
  ],
  "nextSteps": [
    {
      "command": "pnpm install --no-frozen-lockfile",
      "cwd": "/home/me/projects/my-app"
    },
    {
      "command": "pnpm db:migrate",
      "note": "create the tables in the local D1",
      "cwd": "/home/me/projects/my-app"
    }
  ],
  "warnings": []
}
```

## `list`

`addons` has every add-on you can pick or add: `id` is what `add` takes. `presets` has the named stacks `create --preset` takes, each with the `stack` it chooses in this version. In an efforge project's root (or with `--cwd` pointing at it), `project` is `true`, the document has the project's `directory` and `stack`, and each add-on has `installed`. Elsewhere `project` is `false`, as `add` would see it; when the directory is inside a project (`my-app/apps/web`) or holds exactly one, `nearby` is that project's path, to pass as `--cwd`.

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
  ],
  "presets": [
    {
      "id": "saas",
      "title": "SaaS",
      "description": "Postgres, Drizzle, auth + orgs, email, storage",
      "stack": {
        "runtime": "cloudflare",
        "database": "postgres",
        "orm": "drizzle",
        "auth": "better-auth-orgs",
        "infra": "none",
        "ai": "none",
        "extras": [
          "storage",
          "email"
        ]
      }
    },
    {
      "id": "ai",
      "title": "AI",
      "description": "D1, Effect SQL, auth, AI (your key), realtime",
      "stack": {
        "runtime": "cloudflare",
        "database": "d1",
        "orm": "effect-sql",
        "auth": "better-auth",
        "infra": "none",
        "ai": "effect-ai-byok",
        "extras": [
          "realtime"
        ]
      }
    },
    {
      "id": "minimal",
      "title": "Minimal",
      "description": "No database or auth: the app and its dashboard",
      "stack": {
        "runtime": "cloudflare",
        "database": "none",
        "orm": "none",
        "auth": "none",
        "infra": "none",
        "ai": "none",
        "extras": []
      }
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
  ],
  "presets": [
    {
      "id": "saas",
      "title": "SaaS",
      "description": "Postgres, Drizzle, auth + orgs, email, storage",
      "stack": {
        "runtime": "cloudflare",
        "database": "postgres",
        "orm": "drizzle",
        "auth": "better-auth-orgs",
        "infra": "none",
        "ai": "none",
        "extras": [
          "storage",
          "email"
        ]
      }
    },
    {
      "id": "ai",
      "title": "AI",
      "description": "D1, Effect SQL, auth, AI (your key), realtime",
      "stack": {
        "runtime": "cloudflare",
        "database": "d1",
        "orm": "effect-sql",
        "auth": "better-auth",
        "infra": "none",
        "ai": "effect-ai-byok",
        "extras": [
          "realtime"
        ]
      }
    },
    {
      "id": "minimal",
      "title": "Minimal",
      "description": "No database or auth: the app and its dashboard",
      "stack": {
        "runtime": "cloudflare",
        "database": "none",
        "orm": "none",
        "auth": "none",
        "infra": "none",
        "ai": "none",
        "extras": []
      }
    }
  ]
}
```

## `info`

Describes one add-on from its manifest. The id resolves the way `add` resolves it (`email`, `extras/email`, `ai`, a clear typo), and an unknown one is [`UnknownAddon`](#unknownaddon). `files` are what it writes and `edits` the files it edits in place (the seams), each with the transforms that edit it. `requires` says what a project needs first (one of `options` for each), `conflicts` the add-ons it can't be with. `card` is its dashboard card module and `agents` the `AGENTS.md` sections it adds, by heading. `docs.page` is its page in efforge's repo. Outside a project, a file, edit, env var or section that only some stacks get carries `when`.

In an efforge project (`--cwd`, default the current directory), the lists hold only what this project gets, and `project` says whether it has the add-on: `add` is the command that adds it, or `null` when it is there already or can't be added alone; then `reason` says why and `alternatives` are the commands that add it with what it needs.

<!-- example: info -->

```sh
npx -y create-efforge info email --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": true,
  "id": "extras/email",
  "slot": "extras",
  "option": "email",
  "title": "Email",
  "description": "Transactional email: a Mailer service on Cloudflare Email Service, printed to the console in development, a dashboard card, plus invitation emails with organizations.",
  "purpose": "Send invitations, receipts and password resets. Call `send` on the `Mailer` service. In production the layer sends through Cloudflare Email Service; in development (`MAIL_TRANSPORT=console`) it prints each message to the dev server log. With organizations, invitations are emailed too.",
  "docs": {
    "page": "docs/addons/extras-email.md",
    "url": "https://github.com/amagdy46/efforge/blob/main/docs/addons/extras-email.md"
  },
  "service": {
    "name": "Mailer",
    "file": "packages/core/src/mailer.ts",
    "errors": [
      "MailerError",
      "MailerConfigError"
    ]
  },
  "layer": "MailerLive",
  "files": [
    {
      "path": "apps/web/src/capabilities/email.tsx"
    },
    {
      "path": "apps/web/src/server/email-demo.ts"
    },
    {
      "path": "apps/web/src/server/mailer.ts"
    }
  ],
  "edits": [
    {
      "file": "AGENTS.md",
      "transforms": [
        "appendAgentsSection"
      ]
    },
    {
      "file": "apps/web/src/capabilities/registry.ts",
      "transforms": [
        "addArrayItem"
      ]
    },
    {
      "file": "apps/web/src/server/email-demo.ts",
      "transforms": [
        "addServerFnMiddleware"
      ]
    },
    {
      "file": "apps/web/src/server/layers.ts",
      "transforms": [
        "addLayer"
      ]
    },
    {
      "file": "packages/core/src/index.ts",
      "transforms": [
        "addExport"
      ]
    },
    {
      "file": "wrangler.jsonc",
      "transforms": [
        "addWranglerBinding"
      ]
    }
  ],
  "dependencies": [],
  "scripts": [],
  "env": [
    {
      "name": "MAIL_FROM",
      "description": "Sender address; its domain must be enabled for Cloudflare Email Sending (wrangler email sending enable <domain>)",
      "example": "noreply@example.com",
      "secret": false,
      "set": true
    },
    {
      "name": "MAIL_TRANSPORT",
      "description": "cloudflare (default) sends through the EMAIL binding; console prints emails instead (the local value)",
      "example": "cloudflare",
      "secret": false,
      "set": true
    }
  ],
  "requires": [],
  "conflicts": [],
  "card": {
    "module": "apps/web/src/capabilities/email.tsx",
    "export": "email"
  },
  "agents": [
    {
      "heading": "Email"
    }
  ],
  "project": {
    "directory": "/home/me/projects/my-app",
    "installed": false,
    "add": "npx -y create-efforge add extras/email --cwd my-app",
    "alternatives": []
  }
}
```

## `graph`

The project's layer graph, read from `apps/web/src/server/layers.ts`: every argument of `AppLayer = Layer.mergeAll(...)`, in order. `layers` has each one's `name`, `expression` as written, the `addon` that adds it (`base` for the logger, `null` for a layer you added), what it `provides` and what it `needs` (layers provided to it there with `Layer.provide`, bindings and settings), and its tempering `color`. For a layer you added, `provides` and `needs` are `null`: efforge doesn't guess. `nodes` and `edges` are the same graph for drawing (`merges` into `app`, `needs` into a layer), and `mermaid` is what `graph` prints. With `--write`, `written` is `README.md`.

<!-- example: graph -->

```sh
npx -y create-efforge graph --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": true,
  "directory": "/home/me/projects/my-app",
  "file": "apps/web/src/server/layers.ts",
  "layers": [
    {
      "name": "Logger.layer",
      "expression": "Logger.layer([Logger.consolePretty()])",
      "addon": "base",
      "provides": [
        "Logger"
      ],
      "needs": [],
      "color": "Straw"
    },
    {
      "name": "DatabaseLayer",
      "expression": "DatabaseLayer.pipe(Layer.provide(WorkerEnvLive))",
      "addon": "orm/drizzle",
      "provides": [
        "Database",
        "Notes"
      ],
      "needs": [
        "WorkerEnvLive",
        "database binding"
      ],
      "color": "Bronze"
    },
    {
      "name": "AuthLive",
      "expression": "AuthLive",
      "addon": "auth/better-auth",
      "provides": [
        "Auth",
        "BetterAuth"
      ],
      "needs": [
        "BETTER_AUTH_SECRET"
      ],
      "color": "Temper purple"
    }
  ],
  "nodes": [
    {
      "id": "app",
      "kind": "app",
      "label": "AppLayer"
    },
    {
      "id": "l0",
      "kind": "layer",
      "label": "Logger.layer"
    },
    {
      "id": "l1",
      "kind": "layer",
      "label": "DatabaseLayer"
    },
    {
      "id": "l2",
      "kind": "layer",
      "label": "AuthLive"
    },
    {
      "id": "n0",
      "kind": "need",
      "label": "WorkerEnvLive"
    },
    {
      "id": "n1",
      "kind": "need",
      "label": "database binding"
    },
    {
      "id": "n2",
      "kind": "need",
      "label": "BETTER_AUTH_SECRET"
    }
  ],
  "edges": [
    {
      "from": "l0",
      "to": "app",
      "kind": "merges"
    },
    {
      "from": "l1",
      "to": "app",
      "kind": "merges"
    },
    {
      "from": "l2",
      "to": "app",
      "kind": "merges"
    },
    {
      "from": "n0",
      "to": "l1",
      "kind": "needs"
    },
    {
      "from": "n1",
      "to": "l1",
      "kind": "needs"
    },
    {
      "from": "n2",
      "to": "l2",
      "kind": "needs"
    }
  ],
  "mermaid": "flowchart LR\n  app[[\"AppLayer<br/>apps/web/src/server/layers.ts\"]]:::app\n  l0[\"<b>Logger.layer</b><br/>provides Logger\"]:::t1\n  l1[\"<b>DatabaseLayer</b><br/>provides Database, Notes\"]:::t2\n  l2[\"<b>AuthLive</b><br/>provides Auth, BetterAuth\"]:::t3\n  n0([\"WorkerEnvLive\"]):::need\n  n1([\"database binding\"]):::need\n  n2([\"BETTER_AUTH_SECRET\"]):::need\n  l0 --> app\n  l1 --> app\n  l2 --> app\n  n0 -.-> l1\n  n1 -.-> l1\n  n2 -.-> l2\n  classDef t1 fill:#d6d0af,stroke:#9A8C33,color:#1C1D20,stroke-width:2px\n  classDef t2 fill:#dbc4b1,stroke:#A8683A,color:#1C1D20,stroke-width:2px\n  classDef t3 fill:#cab9cf,stroke:#774990,color:#1C1D20,stroke-width:2px\n  classDef app fill:#1C1D20,stroke:#C9CDD2,color:#F6F5F1\n  classDef need fill:#C9CDD2,stroke:#C9CDD2,color:#1C1D20",
  "written": null
}
```

## `upgrade`

`upgrade` brings a project up to date with this efforge and leaves the owner's work alone. `upgrade --check` says what it would do and changes nothing. Both compare the project with what this efforge generates for its stack, using two records: the hash in efforge.jsonc of each file efforge wrote, and what each efforge release generated ([ADR 0010](decisions/0011-upgrade-applies-what-efforge-can-prove.md)). A file, pin or script either record shows is efforge's own older output is efforge's to move; anything else is yours, and stays as it is.

`upgrade` applies one consistent set: the Effect guard and `packageManager`, the pins efforge wrote, the scripts and dependencies it wrote, files it wrote that you haven't changed, new files, and in a file you changed that efforge edits in place, what a new file needs there (a `// #region` block, a declaration), added with the same transforms `add` uses. A file that would break something of yours, or needs something efforge can't add safely, is held back with the file that needs it, and `kept` says why. It computes everything first and writes nothing if any step fails, refuses uncommitted changes (`--allow-dirty` to go ahead anyway), runs `pnpm install` when dependencies changed (`--no-install` to skip), and records the version and the new hashes in efforge.jsonc. `--dry-run` shows the plan. An efforge older than the one that made or last upgraded the project refuses ([`ProjectNewerThanCli`](#projectnewerthancli)).

### `upgrade --check`

`status` answers two questions apart:

- `needs-action`: something breaks the project now (exit code `2`). Each of `needsAction` has an `id` (`effect-overrides`, `package-manager`, `split-set`, `missing-seam`, `install`), a `message`, and a `fix`: a command after which it is fixed (usually `upgrade`), or `null` with `lines`.
- `behind`: nothing breaks, and `upgrade` has something to apply (exit code `0`, or `3` with `--strict`).
- `current`: nothing to apply. Files you changed whose template also changed are in `kept`; they never make a project behind.

The rest:

- `pins`: every pin in the pnpm catalog, plus `packageManager` and the exact pins of a package with its own Docker build: `same`, `behind` (a release pinned this version; `upgrade` moves it), `yours` (no release did; never moved) or `unmanaged`. `set` names the group it moves with; `held: true` marks a pin `upgrade` keeps because another pin of its set is yours. `sets` lists each group with a member that differs, `split: true` when efforge's pins in it aren't ones a release pinned together.
- `guards`: `effect-overrides` (every Effect package held at the catalog's `effect`, [ADR 0005](decisions/0005-effect-lockstep-overrides.md)) and `package-manager` (a pnpm that honours those overrides, 12.17.0 or later).
- `files`: each generated file by `status`. `current`: as efforge writes it today. `refresh`: efforge's own older output, and the template moved: `upgrade` replaces it. `review`: you changed it and so did the template. `yours`: you changed it; it has everything today's has. `deleted`: you removed it. `dropped`: efforge no longer generates it (`upgrade` removes it when it is efforge's, unedited). `new`: efforge generates it today. `inPlace: true` marks a file efforge edits in place (`layers.ts`, `AGENTS.md`), judged by the release record instead of a hash. `held` says why `upgrade` keeps one it would otherwise apply, `why` what efforge's change is for. With `--diff`, `diff` is a git diff from yours to efforge's.
- `seams`: files `upgrade` edits in place, with `missing` (what it adds, one line each) and `diff`.
- `scripts`: package.json scripts that differ from today's template: `behind` when a release wrote yours, `yours` otherwise.
- `env`: env vars the stack reads today that `.env.example` lacks, each as `create` and `add` report one (`name`, `description`, `file`, `set`, `secret`). `upgrade` appends them to `.env.example`, and to the local settings file (`.dev.vars`, or `.env` with Alchemy) when there is one, as `add` does: no line already there changes. A script today's templates define that no release wrote for your stack is added the same way; one a release wrote that you removed stays removed.
- `kept`: what `upgrade` won't change for you, each with `status` (`review`, `held`), `reason` and, where efforge can name them, the exact `lines` that would let it apply.
- `steps`: what to do, in order, ending with the project's gate. The `upgrade` step's `covers` lists what it applies (`effect-overrides`, `package-manager`, `pins`, `scripts`, `seams`, `env`, `refresh`, `new`, `remove`, `manifest`, `install`), so an agent knows not to repeat any of it by hand.

`--file <path>` with `--diff` limits the diffs to one file.

Here, `my-app` was made by this efforge; there is nothing to apply.

<!-- example: upgrade -->

```sh
npx -y create-efforge upgrade --check --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": true,
  "check": true,
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
  "efforgeVersion": {
    "project": "0.2.1",
    "cli": "0.2.1",
    "status": "same"
  },
  "status": "current",
  "needsAction": [],
  "pins": [
    {
      "name": "@cloudflare/vite-plugin",
      "project": "1.70.0",
      "efforge": "1.70.0",
      "status": "same",
      "where": "catalog"
    },
    {
      "name": "@cloudflare/workers-types",
      "project": "5.20261118.1",
      "efforge": "5.20261118.1",
      "status": "same",
      "where": "catalog"
    },
    {
      "name": "@effect/sql-d1",
      "project": "4.1.4",
      "efforge": "4.1.4",
      "status": "same",
      "where": "catalog",
      "set": "effect"
    }
  ],
  "sets": [],
  "guards": [
    {
      "id": "effect-overrides",
      "ok": true,
      "message": "Every Effect package is held at effect 4.1.4."
    },
    {
      "id": "package-manager",
      "ok": true,
      "message": "packageManager pins pnpm 12.21.0, which honours the Effect overrides."
    }
  ],
  "files": [
    {
      "path": ".gitignore",
      "status": "current"
    },
    {
      "path": ".nvmrc",
      "status": "current"
    },
    {
      "path": "AGENTS.md",
      "status": "current",
      "inPlace": true
    }
  ],
  "seams": [],
  "scripts": [],
  "env": [],
  "kept": [],
  "steps": [],
  "warnings": [],
  "notes": []
}
```

Here, `my-app` is pinned like a 0.2.0 project: effect 4.0.5, no overrides, pnpm 12.4.2.

<!-- example: upgrade-drifted -->

```sh
npx -y create-efforge upgrade --check --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": true,
  "check": true,
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
  "efforgeVersion": {
    "project": "0.2.0",
    "cli": "0.2.1",
    "status": "behind"
  },
  "status": "needs-action",
  "needsAction": [
    {
      "id": "effect-overrides",
      "message": "pnpm-workspace.yaml has no overrides holding Effect's packages at effect 4.0.5. A library that asks for a newer one then installs it next to the older effect and the build breaks, as 0.2.0 projects did when Effect 4.1 shipped.",
      "fix": "npx -y create-efforge upgrade --cwd my-app"
    },
    {
      "id": "package-manager",
      "message": "packageManager pins pnpm 12.4.2, which accepts the Effect overrides and silently ignores them (they work from pnpm 12.17.0).",
      "fix": "npx -y create-efforge upgrade --cwd my-app"
    }
  ],
  "pins": [
    {
      "name": "@cloudflare/vite-plugin",
      "project": "1.70.0",
      "efforge": "1.70.0",
      "status": "same",
      "where": "catalog"
    },
    {
      "name": "@cloudflare/workers-types",
      "project": "5.20261118.1",
      "efforge": "5.20261118.1",
      "status": "same",
      "where": "catalog"
    },
    {
      "name": "@effect/sql-d1",
      "project": "4.0.5",
      "efforge": "4.1.4",
      "status": "behind",
      "where": "catalog",
      "set": "effect"
    }
  ],
  "sets": [
    {
      "id": "effect",
      "why": "Effect's packages are released together and only work at one shared version; the overrides in pnpm-workspace.yaml must match the catalog's effect (ADR 0005)",
      "packages": [
        "@effect/sql-d1",
        "@effect/vitest",
        "effect"
      ],
      "split": false
    }
  ],
  "guards": [
    {
      "id": "effect-overrides",
      "ok": false,
      "message": "pnpm-workspace.yaml has no overrides holding Effect's packages at effect 4.0.5. A library that asks for a newer one then installs it next to the older effect and the build breaks, as 0.2.0 projects did when Effect 4.1 shipped.",
      "missing": [
        "effect@>=4.0.0-0",
        "@effect/ai-*",
        "@effect/atom-*",
        "@effect/openapi-generator",
        "@effect/opentelemetry",
        "@effect/platform-*",
        "@effect/sql-*",
        "@effect/vitest"
      ]
    },
    {
      "id": "package-manager",
      "ok": false,
      "message": "packageManager pins pnpm 12.4.2, which accepts the Effect overrides and silently ignores them (they work from pnpm 12.17.0)."
    }
  ],
  "files": [
    {
      "path": ".gitignore",
      "status": "current"
    },
    {
      "path": ".nvmrc",
      "status": "current"
    },
    {
      "path": "AGENTS.md",
      "status": "current",
      "inPlace": true
    }
  ],
  "seams": [],
  "scripts": [],
  "env": [],
  "kept": [],
  "steps": [
    {
      "id": "upgrade",
      "description": "Apply what efforge can, leaving your changes alone: the Effect guard, 4 pins, then pnpm install. It writes nothing if any step fails, and refuses uncommitted changes so git diff shows exactly what it did.",
      "command": "npx -y create-efforge upgrade",
      "cwd": "/home/me/projects/my-app",
      "covers": [
        "effect-overrides",
        "package-manager",
        "pins",
        "manifest",
        "install"
      ]
    },
    {
      "id": "gate",
      "description": "Check the project passes its gate.",
      "command": "pnpm typecheck && pnpm check && pnpm test && pnpm build",
      "cwd": "/home/me/projects/my-app"
    }
  ],
  "warnings": [],
  "notes": []
}
```

### `upgrade`

- `check: false`; `dryRun`.
- `efforgeVersion`: `from` what efforge.jsonc said, `to` what it says now.
- `status`: `current`, or `needs-action` (exit code `2`) when something only you can fix still breaks the project; `needsAction` lists it.
- `created`, `changed`, `removed`: the files, relative to the project. `installed`: whether `pnpm install` ran.
- `env`: the env vars it added, as in `--check`.
- `kept`: as above. `nextSteps`: the commands left to run, each with its `cwd`, ending with the project's gate.
- `notes`: things to know after the upgrade, one line each, as `add` gives them. When it brings the session gates to an auth project made before them, the note `add auth` prints: what they change for server functions and routes, and the server functions `pnpm check` now fails on. `--check` has the same `notes`.
- With `--diff`, `diff` is what it changed, as one git diff.

The same project as above, upgraded:

<!-- example: upgrade-apply -->

```sh
npx -y create-efforge upgrade --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": true,
  "check": false,
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
  "efforgeVersion": {
    "from": "0.2.0",
    "to": "0.2.1"
  },
  "status": "current",
  "created": [],
  "changed": [
    "efforge.jsonc",
    "package.json",
    "pnpm-workspace.yaml"
  ],
  "removed": [],
  "installed": true,
  "env": [],
  "kept": [],
  "needsAction": [],
  "nextSteps": [
    {
      "command": "pnpm typecheck && pnpm check && pnpm test && pnpm build",
      "cwd": "/home/me/projects/my-app"
    },
    {
      "command": "pnpm db:migrate",
      "cwd": "/home/me/projects/my-app"
    }
  ],
  "warnings": [],
  "notes": []
}
```

## `doctor`

Checks the checkout as it is now and says what is wrong. It changes nothing, and it needs no network unless you pass `--online` (to check peers with a pinned pnpm this machine may not have yet, or a database on another host). `status` is the worst check: `fail` (exit code `2`), then `warn`, then `ok`. `stack` is there when efforge.jsonc is valid.

Each of `checks` has a stable `id`, a `status` (`ok`, `warn`, `fail`, `skipped`, `unverified`), a `message` with the reason, and `fix`. A check's `fix` is a promise too: a command after which that check passes and no other check is worse, or `null` with the facts in `message` and `details` (what to add, or the command to run once you have done something only you can do, such as committing). `unverified` means the check couldn't read what it looks for in the shape it knows (a layer of yours where efforge's was, an `env` object built another way); `details.lookedFor` says what, and it counts like `warn`. Never a secret's value: `env` reports in `details.vars` each name, whether the code requires it, and its `status`: `ok`, `missing`, `empty`, `fill-in` (efforge wrote it empty for you to fill in, such as an API key; a warning), a `placeholder` or `undocumented` (not in `.env.example`). Each also has `secret` and `set`, meaning what they mean in `create`, `add` and `info`.

| `id` | Looks at |
|---|---|
| `node` | Node against `engines` (efforge's own range when the project has none). |
| `pnpm` | pnpm on PATH, and `packageManager` new enough to honour the Effect overrides. |
| `manifest` | efforge.jsonc against its schema. |
| `ignored` | Whether git ignores the project's files: a project that isn't its own repository, under a `.gitignore` that ignores everything (a dotfiles repository in `~` with `*`), has no files for `pnpm check` and no styles from Tailwind. `fix` is `git init` in the project; `details.rule` names the rule and its file. |
| `install` | `node_modules` installed by pnpm and matching the package.json files, `pnpm-workspace.yaml` and `pnpm-lock.yaml`. |
| `effect` | One Effect: every package released with `effect` resolved to the catalog's version, from the installed lockfile. |
| `effect-guard` | The overrides that keep it so. |
| `peers` | `pnpm peers check`, with the pnpm `packageManager` pins when that pnpm made `node_modules` (else skipped, saying how to run it); the upstream Alchemy `unenv` issue and optional peers out of range are known, not failures. |
| `env` | Every env var the add-ons declare and the app's code reads, against `.dev.vars` (or `.env` with Alchemy) and `.env.example`. |
| `bindings` | What the add-ons bind (D1, R2, Hyperdrive, Durable Objects, Workflows, email), against `wrangler.jsonc` or `infra/alchemy.run.ts`. |
| `migrations` | D1 migrations not yet applied to the local database. |
| `postgres` | Whether the local Postgres answers (nothing is started). |
| `layers` | A layer in `layers.ts` for each add-on that adds one, read as code (a commented-out layer is missing; `AppLayer` built from another const counts). |
| `gates` | On a stack with auth: `sessionGate` first in `functionMiddleware`, passed to `createStart` (`apps/web/src/start.ts`), and `requireApiSession` first in `workerRoutes` (`apps/web/src/server/routes.ts`). A gate taken out, or something listed before it, fails with `details.problems` (each `file`, `problem` and the `lines` to put back); skipped without auth. |
| `upgrade` | `upgrade --check`'s answer: `fail` for needs-action, `warn` for behind. |

New checks can appear without a change of contract; treat an unknown `id` like the others.

Here, `my-app` was created with `--no-install`.

<!-- example: doctor -->

```sh
npx -y create-efforge doctor --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": true,
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
  "status": "fail",
  "checks": [
    {
      "id": "node",
      "status": "ok",
      "message": "Node 24.11.1; package.json engines asks for ^24.11.0 || >=26.0.0.",
      "fix": null
    },
    {
      "id": "pnpm",
      "status": "ok",
      "message": "pnpm 12.21.0, as packageManager pins.",
      "fix": null,
      "details": {
        "pnpm": "12.21.0",
        "packageManager": "12.21.0"
      }
    },
    {
      "id": "manifest",
      "status": "ok",
      "message": "efforge.jsonc is valid: made with efforge 0.2.1.",
      "fix": null
    },
    {
      "id": "ignored",
      "status": "ok",
      "message": "git doesn't ignore the project's files.",
      "fix": null
    },
    {
      "id": "install",
      "status": "fail",
      "message": "Dependencies aren't installed (no node_modules).",
      "fix": "cd my-app && pnpm install --no-frozen-lockfile"
    },
    {
      "id": "effect",
      "status": "skipped",
      "message": "Nothing is installed or locked yet.",
      "fix": null
    },
    {
      "id": "effect-guard",
      "status": "ok",
      "message": "pnpm-workspace.yaml holds every Effect package at 4.1.4.",
      "fix": null
    },
    {
      "id": "peers",
      "status": "skipped",
      "message": "Nothing is installed yet.",
      "fix": null
    },
    {
      "id": "env",
      "status": "ok",
      "message": "2 env vars set in .dev.vars or documented as optional.",
      "fix": null,
      "details": {
        "file": ".dev.vars",
        "vars": [
          {
            "name": "BETTER_AUTH_SECRET",
            "required": true,
            "status": "ok",
            "secret": true,
            "set": true
          },
          {
            "name": "BETTER_AUTH_URL",
            "required": false,
            "status": "empty",
            "secret": false,
            "set": true
          }
        ]
      }
    },
    {
      "id": "bindings",
      "status": "ok",
      "message": "wrangler.jsonc has the 1 binding this stack needs (d1_databases DB).",
      "fix": null
    },
    {
      "id": "migrations",
      "status": "warn",
      "message": "2 of 2 migrations aren't applied to the local D1 database (0001_init.sql, 0002_auth.sql), so pnpm dev runs against missing tables.",
      "fix": "cd my-app && pnpm db:migrate",
      "details": {
        "pending": [
          "0001_init.sql",
          "0002_auth.sql"
        ],
        "applied": []
      }
    },
    {
      "id": "postgres",
      "status": "skipped",
      "message": "This stack doesn't use Postgres.",
      "fix": null
    },
    {
      "id": "layers",
      "status": "ok",
      "message": "AppLayer has a layer for each add-on (orm/drizzle, auth/better-auth).",
      "fix": null
    },
    {
      "id": "gates",
      "status": "ok",
      "message": "sessionGate is first in functionMiddleware (apps/web/src/start.ts) and requireApiSession first in workerRoutes (apps/web/src/server/routes.ts).",
      "fix": null
    },
    {
      "id": "upgrade",
      "status": "ok",
      "message": "Made with efforge 0.2.1; nothing to apply from efforge 0.2.1.",
      "fix": null,
      "details": {
        "status": "current"
      }
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

Fields: `arguments`. `fix`: For `create`, `null`: a project name is one word, and efforge doesn't guess which. For `list` and `graph`, the command without them.

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
    "message": "Unknown command lst. Did you mean list? The commands are create, add, list, info, graph, upgrade, doctor. To name a project lst, run npx -y create-efforge create lst.",
    "fix": "npx -y create-efforge list --json",
    "command": "lst",
    "suggestion": "list",
    "commands": [
      "create",
      "add",
      "list",
      "info",
      "graph",
      "upgrade",
      "doctor"
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
    "message": "This is inside the efforge project /home/me/projects/my-app, so efforge doesn't create a project here without the word create. The commands are create, add, list, info, graph, upgrade, doctor. To add to this project, run npx -y create-efforge add <id>; to create a project inside it anyway, run npx -y create-efforge create app2.",
    "fix": null,
    "project": "/home/me/projects/my-app",
    "name": "app2",
    "commands": [
      "create",
      "add",
      "list",
      "info",
      "graph",
      "upgrade",
      "doctor"
    ]
  }
}
```

### `NeedsInput`

Without `--json` and without a terminal (stdin is not a TTY, or `CI` is set), a prompt was needed. It fails at once instead of waiting. `--json` never prompts, so it never returns this code; the example is the text on stderr.

Fields: `prompt` (`name`, `preset`, `confirm` or a slot id), `flag`, `allowed`. The first question after the name is `preset` unless a stack flag or `--yes` already chose; `--preset` or any stack flag answers it. `fix`: The command with `--yes`, which takes the default for every choice a flag didn't make.

<!-- example: NeedsInput -->

```sh
npx -y create-efforge create my-app
```

```text
No terminal to ask for "preset": pass --preset=saas|ai|minimal or the stack
flags, or --yes to accept the defaults.
Try: npx -y create-efforge create my-app --yes
```

### `UnknownValue`

A stack flag, or `--preset`, got a value that isn't one of its options.

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

Fields: `flag` and `value` (create) or `slot` and `value` (add), `allowed` (the values that slot can take as things stand), `reason`, and `alternatives`: every way out, each `{ command, description }`, where `command` is your command with one change, complete and non-interactive. For `create`, a way out is one flag changed (another value for either side of the conflict, another preset, or an extra left out), or two changed where neither alone is enough (auth on the minimal preset needs `--database` and `--orm`). For `add`, it is your command with the smallest set of add-ons added that satisfies the rules. `add` also has `needs`: the slots that must be filled in the same command, each `{ slot, options }` with the ids that can fill it. `fix`: None. Pick one of `alternatives` (or ask the user which), and run it.

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
        "set": true,
        "secret": true
      },
      {
        "name": "BETTER_AUTH_SECRET",
        "description": "Signs sessions and cookies (production: a Worker secret, `wrangler secret put BETTER_AUTH_SECRET` or the deploy env with Alchemy)",
        "file": ".dev.vars",
        "set": true,
        "secret": true
      },
      {
        "name": "BETTER_AUTH_URL",
        "description": "Public origin of the deployed app, used for redirects and trusted origins (a Worker var). When unset, the origin comes from each request (under pnpm dev, localhost on any port).",
        "file": ".dev.vars",
        "set": true,
        "secret": false
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
        "set": true,
        "secret": true
      },
      {
        "name": "BETTER_AUTH_SECRET",
        "description": "Signs sessions and cookies (production: a Worker secret, `wrangler secret put BETTER_AUTH_SECRET` or the deploy env with Alchemy)",
        "file": ".dev.vars",
        "set": true,
        "secret": true
      },
      {
        "name": "BETTER_AUTH_URL",
        "description": "Public origin of the deployed app, used for redirects and trusted origins (a Worker var). When unset, the origin comes from each request (under pnpm dev, localhost on any port).",
        "file": ".dev.vars",
        "set": true,
        "secret": false
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

`add`, `upgrade` or `doctor` ran in a directory without `efforge.jsonc`, or (`add`, `upgrade`) the file isn't valid; `doctor` reports an invalid one as its `manifest` check. `list --cwd` gets it only when the directory doesn't exist, isn't a directory, or its `efforge.jsonc` isn't valid; `list` in a directory without one succeeds with `project: false` (and `nearby`).

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

`add` got no add-on ids and there is no terminal to pick them in (or `--json`), or `info` got no id.

Fields: `available`: the ids the project can still add (for `info`, every id). `fix`: `null`: which add-on is your choice, and a list isn't an add. The message names the `list --json` command that says what each one adds.

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
    "message": "Name the add-ons to add: infra/alchemy, ai/effect-ai-byok, extras/workflows, extras/realtime, extras/browser, extras/storage, extras/email. What each one adds: npx -y create-efforge list --json --cwd my-app",
    "fix": null,
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

### `UpgradeFirst`

`add` would write a dashboard card that the project's card boundary can't typecheck: `apps/web/src/server/outcome.ts` is from an efforge made before server functions returned an `Exit` (a project made between releases). Nothing was written. An add-on without a card is not held up.

Fields: `file` (the boundary file), `addons` (the add-ons whose cards need the newer boundary), `then` (this `add`, to run once `upgrade` is done). `fix`: `upgrade` in the same project (keeping `--cwd` and `--json`), which brings the boundary up to date; then run `then`.

<!-- example: UpgradeFirst -->

```sh
npx -y create-efforge add realtime --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "UpgradeFirst",
    "message": "apps/web/src/server/outcome.ts is from an older efforge: the dashboard card of extras/realtime would not typecheck against it. Nothing was written. Run npx -y create-efforge upgrade --json --cwd my-app first, then this add again.",
    "fix": "npx -y create-efforge upgrade --json --cwd my-app",
    "file": "apps/web/src/server/outcome.ts",
    "addons": [
      "extras/realtime"
    ],
    "then": "npx -y create-efforge add realtime --json --cwd my-app"
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

`add` or `upgrade` wrote its files, then a command it runs failed (`pnpm install`).

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
        "card": "apps/web/src/capabilities/ai.tsx",
        "agents": [
          "AI (Effect AI, bring your own key)"
        ]
      }
    ],
    "skipped": [],
    "created": [
      "apps/web/src/capabilities/ai.tsx",
      "apps/web/src/server/ai-demo.ts",
      "apps/web/src/server/ai.ts",
      "apps/web/src/server/llm-provider.ts",
      "apps/web/src/server/llm.ts",
      "packages/core/src/llm.ts",
      "packages/core/test/llm-fixed.ts",
      "packages/core/test/llm.test.ts"
    ],
    "changed": [
      ".dev.vars",
      ".env.example",
      "AGENTS.md",
      "README.md",
      "apps/web/package.json",
      "apps/web/src/capabilities/registry.ts",
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
        "set": true,
        "secret": false
      },
      {
        "name": "LLM_MODEL",
        "description": "Model id for the provider",
        "file": ".dev.vars",
        "set": true,
        "secret": false
      },
      {
        "name": "LLM_API_KEY",
        "description": "Provider API key (not needed for a local Ollama); a Worker secret in production",
        "file": ".dev.vars",
        "set": false,
        "secret": true
      },
      {
        "name": "LLM_BASE_URL",
        "description": "Optional OpenAI-compatible endpoint (openai, ollama)",
        "file": ".dev.vars",
        "set": true,
        "secret": false
      }
    ],
    "nextSteps": [
      {
        "command": "pnpm install --no-frozen-lockfile",
        "cwd": "/home/me/projects/my-app"
      },
      {
        "command": "pnpm db:migrate",
        "note": "create the tables in the local D1",
        "cwd": "/home/me/projects/my-app"
      }
    ],
    "warnings": []
  }
}
```

### `ProjectNewerThanCli`

`upgrade` was run by an efforge older than the one that made or last upgraded the project (efforge.jsonc's `efforgeVersion`). It would compare the project with older templates and undo what the newer efforge did, so it writes nothing. `fix` is `null`; `command` is the same command with `create-efforge@latest`. Also: `project`, `cli`.

<!-- example: ProjectNewerThanCli -->

```sh
npx -y create-efforge upgrade --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "ProjectNewerThanCli",
    "message": "This project was made or upgraded with efforge 0.4.0, newer than this CLI (0.2.1). An older efforge would undo what the newer one did, so it stops here. Run npx -y create-efforge@latest upgrade --json --cwd my-app.",
    "fix": null,
    "project": "0.4.0",
    "cli": "0.2.1",
    "command": "npx -y create-efforge@latest upgrade --json --cwd my-app"
  }
}
```

### `UncommittedChanges`

`upgrade` found changes in the project that aren't committed. It writes nothing, so that `git diff` afterwards shows exactly what it did. `fix` is `null`: commit or stash first. `files` lists them; `command` is the same command with `--allow-dirty`, which applies on top of them.

<!-- example: UncommittedChanges -->

```sh
npx -y create-efforge upgrade --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "UncommittedChanges",
    "message": "my-app has changes that aren't committed (package.json, notes.md). Commit or stash them first, so git diff shows exactly what upgrade did. Nothing was written. To apply on top of them anyway: npx -y create-efforge upgrade --json --cwd my-app --allow-dirty",
    "fix": null,
    "files": [
      "package.json",
      "notes.md"
    ],
    "command": "npx -y create-efforge upgrade --json --cwd my-app --allow-dirty"
  }
}
```

### `LayersUnreadable`

`graph` couldn't read the layers: `apps/web/src/server/layers.ts` is missing, or it has no `export const AppLayer = Layer.mergeAll(...)` (efforge add needs that call too).

Fields: `file`, `reason`. `fix`: None.

<!-- example: LayersUnreadable -->

```sh
npx -y create-efforge graph --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "LayersUnreadable",
    "message": "Can't read the layer graph from apps/web/src/server/layers.ts: it has no `export const AppLayer = Layer.mergeAll(...)`. efforge add keeps that call; put it back to see the graph.",
    "fix": null,
    "file": "apps/web/src/server/layers.ts",
    "reason": "it has no `export const AppLayer = Layer.mergeAll(...)`"
  }
}
```

### `ReadmeUnwritable`

`graph --write` found no `efforge:readme` markers in `README.md` (a project from before efforge 0.3, or a rewritten README), broken ones, or no README. Nothing was written.

Fields: `file`, `problems`. `fix`: None. Repair the markers `problems` names, or paste the output of `graph` yourself.

<!-- example: ReadmeUnwritable -->

```sh
npx -y create-efforge graph --write --json --cwd my-app
```

```json
{
  "efforge": "0.2.1",
  "contract": 1,
  "ok": false,
  "error": {
    "code": "ReadmeUnwritable",
    "message": "README.md has no efforge:readme markers (made before efforge 0.3, or rewritten), so it was left as it is. Nothing was written. Fix the markers, or paste the output of npx -y create-efforge graph where you want it.",
    "fix": null,
    "file": "README.md",
    "problems": [
      "README.md has no efforge:readme markers (made before efforge 0.3, or rewritten), so it was left as it is"
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
