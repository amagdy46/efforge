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
  command with the smallest change that gets past the error (the closest
  flag, a free directory name, `--cwd` pointed at the nearby project, the ids
  `add` needs with it), or `null` when no command fixes it. A fix only picks
  a value when there is one obvious candidate; otherwise it points at `list`.
  The text output gets the same fix as a `Try:` line.
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
- A first argument one deletion or one swap away from `create`, `add` or
  `list` is refused with `UnknownCommand`. `create <name>` still allows any
  valid name.

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
- A `fix` is a suggestion, not a promise of intent: `OverlayConflict`'s fix
  adds `--overwrite`, which discards the user's edits. The docs and the skill
  say to show the diff first.
- Projects named `lst`, `ad` or `craete` need `create` spelled out.
