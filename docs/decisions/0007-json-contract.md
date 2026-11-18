# 0007 — `--json` is a versioned contract, and every error says what to run instead

Date: 2026-11-18. Status: accepted.

## Context

efforge has two audiences: a person at the prompts, and a coding agent with no
terminal that has never heard of efforge. Before 0.3, `--json` existed but was
thin and undocumented: `create` printed `{stack, command, files}`, `list` a
bare array, errors `{error: {code, message}}` with Effect's internal tag names
as codes. Nothing said what an agent should do next, after success or failure.
A first argument like `lst` was taken as a project name, so `create-efforge lst
--json` created a project called "lst".

The TanStack CLI removed its MCP server in favour of JSON output plus an agent
skill. An MCP server would be one more thing to install and keep in step with
the CLI; the CLI itself is already the interface.

## Decision

- `create`, `add` and `list` print one JSON document under `--json`, success
  or failure, and nothing else on stdout or stderr. `--json` never prompts.
- Every document starts with `efforge` (the CLI version), `contract` (an
  integer, 1) and `ok`. `contract` changes only when a field is renamed or
  removed or changes meaning. New fields and new error codes don't change it,
  so readers must ignore what they don't know.
- Errors are `{ code, message, fix, ...details }`. `code` comes from a list in
  `src/contract.ts` (`errorCodes`) that efforge owns, not from library error
  tags, so upgrading Effect can't rename one. `fix` is the caller's own
  command with the smallest change that gets past the error (a corrected
  flag, `--cwd` pointed at the nearby project, the ids `add` needs with it,
  the setup steps a stopped create still owes), or `null`. The text output
  gets the same fix as a `Try:` line.
- `fix` is a promise: it does what the caller was trying to do, or it is
  `null` and the error carries the facts to decide with (`allowed`, `addons`,
  `commands`, paths). It never substitutes a different capability, never
  creates something the caller didn't ask for (no renamed project, no words
  joined into a name), and never needs a prompt (it starts with
  `npx -y create-efforge`, and a create gets `--yes`).
- The promise is enforced in one place, not per error. `src/fix.ts` reads
  argv into an intent (the command, the name or add-on ids, the flags, with
  `--` understood), and an error builds its fix only by editing that intent.
  `fix()` re-reads the rendered command and refuses it (`null`) unless it
  runs the same command (a fix for anything but a create is never a create),
  keeps the name (only case and spaces normalised), the ids, `--cwd` and
  every switch the caller set, changes a stack value or add-on id only under
  the typo rule, and differs from what the caller ran. The command comes
  first and added flags go before `--`. Setup steps (`finish()`) leave out
  what `--no-install` and `--no-git` declined. A property test
  (`test/fix-property.test.ts`) generates invocations from a seed, follows
  their fixes and checks the rules, so a new error path can't break them
  unnoticed.
- More than one way out is the caller's choice: `fix` is `null` and
  `alternatives` lists each as a complete command with a description
  (`IncompatibleStack`; `add`'s `needs` names the slots to fill). A database
  or an ORM can't be swapped after `add`, so efforge never picks one.
- One typo rule decides when a value counts as meant (`isTypo` in
  `src/contract.ts`): options of one or two characters only match exactly;
  otherwise one edit (a swap of neighbours counts as one) for options up to
  six characters, two for longer ones; and exactly one option may match.
  `postgress` is `postgres`; `mysql`, `d2`, `r2` and `stripe` are nothing.
- An interrupted `create --json` still prints one document (`Interrupted`,
  exit 130) with what was written and the steps that finish it. A failed
  install's document carries what success would have (`env`, `nextSteps`),
  and whether `add` owes an install is read from the project (package.json
  files and pnpm-workspace.yaml against pnpm's `node_modules/.pnpm/lock.yaml`),
  so an install run by hand settles it.
- Success documents carry what the next step needs without parsing prose: the
  project directory, the stack, the files, the env vars with where their local
  value lives, and the next commands, each with the directory to run it in.
- The documents are Effect schemas (`src/schemas.ts`); `node scripts/schemas.ts`
  writes them, and `efforge.jsonc`'s, as JSON Schema into `schemas/`, which the
  package ships. Generated `efforge.jsonc` files point at their version's
  schema with `$schema`.
- `docs/json.md` is the reference. Each example there is produced by running
  the command above it (`test/json-docs.test.ts`), and a child-process test
  (`test/agent.test.ts`) drives create, list and add with no terminal and runs
  every `fix` it gets.
- Discovery is one file: `skills/efforge/SKILL.md` (installable with
  `npx skills add amagdy46/efforge`), plus `llms.txt` and a README section.
  The commands they teach are run by `test/doc-commands.test.ts`.
- The root form takes exactly one word, checked before anything else
  parses: a command in other case or a typo of one, a word people guess as a
  command (`reservedWords` in `src/fix.ts`: `help`, `version`, `update`,
  `init`, `install`, `remove`, `ls`, `run`, `build`, `deploy` and more), more
  than one word, or one word with a flag only `add` or `list` take is
  `UnknownCommand`. Inside an efforge project it creates nothing
  (`InsideProject`): that is where `add` and `list` run. `create <name>` still
  allows any valid name, anywhere.

## Consequences

- The 0.2 shapes changed: `list --json` is an object, `add --json` reports
  `created` and `changed` instead of `written` and `transformed`, `nextSteps`
  entries are objects, and some codes were renamed (`UnrecognizedOption` is
  `UnknownFlag`, `InvalidValue` is `InvalidFlagValue`) or split
  (`UnknownValue` from `IncompatibleStack`; `SlotAlreadySet` and
  `RemoveNotSupported` from `IncompatibleStack` and `UnknownAddon`). This is
  contract 1; changes from here are versioned.
- Every new error needs a code in `errorCodes`, a section and an example in
  `docs/json.md`; the docs test fails until it has both.
- `OverlayConflict`'s fix does what was asked, and also discards the user's
  edits to the files it lists. The docs and the skill say to show the diff
  first.
- Projects named `lst`, `ad`, `help`, `update` or `graph` need `create` spelled out,
  and a new command must be added to the reserved words before it ships.
- Fewer errors have a fix (`--database=mysql`, `add stripe`, a taken
  directory). An agent then has to choose, which is the point.
