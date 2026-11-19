# 0011 — `upgrade` applies what efforge can prove is its own, as one consistent set

Date: 2026-11-19. Status: accepted. Supersedes the `--patch` part of
[0009](0009-upgrade-check-and-doctor.md).

## Context

`upgrade --check --patch | git apply` was the first way to bring a project up to date. A review
that played the owner of real 0.2.0 and 0.2.1 projects and followed the output literally found the
two things an upgrade tool must never do. After efforge's own patch the project did not build,
while `upgrade --check` and `doctor` both said there was nothing left: the refreshed dashboard
needs `// #region card` markers in `layers.ts`, a file efforge edits in place and so never
patched. And the only version of `layers.ts` efforge offered was its own, which deletes the owner's
layer. The patch also failed silently in a project nested in a larger repository, could not run
transforms, could not update `efforge.jsonc`, reverted owner choices (a held-back pin, a replaced
layer, a deleted `AGENTS.md`), and called efforge's own 0.2.0 Drizzle pin "ahead".

## Decision

Two rules sit above everything else:

- An upgrade never leaves a project worse than it found it. What efforge applies is a consistent
  set; where it can't make a change consistently, it doesn't make it, and says why.
- efforge never overwrites or reverts the owner's work, and never calls an owner's choice drift.

So:

- **`upgrade` applies; `--check` reports.** efforge computes the whole set in memory, writes
  nothing if any step fails, refuses uncommitted changes (`--allow-dirty` overrides) so `git diff`
  shows exactly what it did, runs `pnpm install` when dependencies changed, and records the version
  and the new hashes in `efforge.jsonc` (comments kept, through `jsonc-parser`'s edits). `--patch` is
  gone.
- **What is efforge's comes from a record, never a guess.** For a file efforge wrote, the hash in
  `efforge.jsonc`. For everything else, `src/history.ts`: what each release generated, written by
  `scripts/history.ts` from the release's own source at release time, with a test that this
  efforge's version is in it. A release's entry has its pins, `packageManager`, `engines`, every
  package.json's dependencies and scripts (for any stack, and for a script only some stacks get, which stacks: a script missing from a project is one the owner removed only if a release wrote it for that project's stack; otherwise `upgrade` adds it), and for each file efforge edits in place
  a fingerprint record: every run of five tokens it wrote, hashed to 24 bits (`src/record.ts`).
  Tokens, so formatting and line breaks don't count; runs, so a line the owner adds brings runs no
  release wrote. A pin, script or dependency a release wrote (since the one that made the project)
  is efforge's to move; anything else is the owner's. An in-place file whose differences from today
  are all runs a release wrote, with no stretch of a release's runs removed, is efforge's older
  output and is refreshed whole; any other is the owner's. A pin is compared with what efforge wrote,
  not by semver: `1.0.0-rc.5-5935859` can't be ordered against `1.0.0-rc.5` from the strings.
- **Every import the plan touches still holds** (`src/consistency.ts`). A file efforge writes gets
  what it imports: the file, its names, its `?region=` blocks, and the declarations those names use.
  Where a file efforge edits in place lacks one of them, efforge adds it with the same kind of
  idempotent transform `add` uses (`addRegion`, `setDeclaration`, a dependency), and replaces a
  declaration only when the record shows it is efforge's own older one. A file efforge doesn't write
  keeps what it imported: if efforge's new version of a file drops a name an owner's file uses, or
  changes its type (asked of the project's own TypeScript when `node_modules` is there; any change
  of the text counts when it isn't), that file is held back. A held file holds back what needs it,
  to a fixed point, and each one is reported with the reason and, where efforge can name them, the
  lines that would let it apply.
- **Two answers.** `needs-action` (a guard missing, efforge's pins of a set at two releases'
  versions, an import that is broken now, an install owed) is exit code `2`. `behind` (`upgrade` has
  something to apply) is `0`, or `3` with `--strict`. A file the owner changed whose template also
  moved is `kept`, with what the change is for, and never makes a project behind: the owner decides.
- **Owner choices stay.** A pin no release wrote is `yours` and never moves; efforge holds the rest
  of its set rather than split it. A deleted file, a removed `AGENTS.md` section, a replaced layer
  and a renamed binding are not put back. An efforge older than the version in `efforge.jsonc`
  refuses to run `upgrade` (`ProjectNewerThanCli`).

## What efforge can't know

- Whether an in-place file's difference is the owner's when the release that made the project has
  no record (0.1.0 and later have one). Then it is the owner's.
- Which of an owner's changes were meant: efforge only knows what it wrote. A file the owner
  rewrote to say exactly what efforge's template says counts as efforge's.
- Whether a pin of the owner's still installs with the rest of its set; `doctor`'s `peers` check
  answers that.
- Whether code reads something only at runtime (a binding name in a string). The consistency check
  follows imports, regions and declarations, not every use.

## Consequences

- The release process gains a step: `node scripts/history.ts` from the release's source, before
  tagging. The test in `test/upgrade.test.ts` fails while it is missing.
- `upgrade` reads the project's TypeScript when an owner's file imports something efforge changes;
  that costs a few seconds on a large project, and only then.
- A project whose owner edited a file that efforge's new files depend on stays partly on the old
  templates until the owner takes efforge's version of that file. The output says which file, and
  which files wait on it.
