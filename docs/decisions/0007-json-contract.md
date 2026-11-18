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
- One typo rule decides when a value counts as meant (`isTypo` in
  `src/contract.ts`): options of one or two characters only match exactly;
  otherwise one edit (a swap of neighbours counts as one) for options up to
  six characters, two for longer ones; and exactly one option may match.
  `postgress` is `postgres`; `mysql`, `d2`, `r2` and `stripe` are nothing.
- An interrupted `create --json` still prints one document (`Interrupted`,
  exit 130) with what was written and the steps that finish it. A failed
  install's document carries what success would have (`env`, `nextSteps`),
  and `add` remembers an install it owes until one succeeds.
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
  parses: a reserved word (`help`, `version`, and `upgrade`, `doctor`,
  `info`, `graph` for commands to come), a typo of a command, more than one
  word, or one word with a flag only `add` or `list` take is
  `UnknownCommand`. `create <name>` still allows any valid name.

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
- Projects named `lst`, `ad`, `help` or `graph` need `create` spelled out,
  and a new command must be added to the reserved words before it ships.
- Fewer errors have a fix (`--database=mysql`, `add stripe`, a taken
  directory). An agent then has to choose, which is the point.
