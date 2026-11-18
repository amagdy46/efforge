# 0009 — `upgrade --check` reports drift from today's templates, `doctor` checks the checkout

Date: 2026-11-18. Status: accepted.

## Context

Effect 4.1 shipped three weeks after efforge 0.2.0. The pins went stale,
projects with a database stopped building, and nobody noticed until someone
tried. 0.2.1 fixed the templates, and `efforge add` repairs an old project's
Effect guard as a side effect, but nothing told a project owner, or their
coding agent, how their project differs from what efforge generates now, or
why a checkout fails. "Every capability is a layer you can add, see, test and
upgrade" needs both.

## Decision

- `upgrade --check` renders today's templates for the project's own stack in
  memory and compares. It reports the pins (grouped into the sets that move
  together, `pinSets` in `src/versions.ts`), the two guards of ADR 0005,
  every generated file by bucket, seams, scripts, and ordered steps. It never
  writes. Bare `upgrade` is an error (`UpgradeNeedsCheck`) until applying
  exists; the document already says `check: true`, so an apply can say
  `false` without a change of contract.
- efforge.jsonc holds the hash of what efforge wrote, not the content, so
  efforge can tell *who* changed a file (the hash) and whether the template
  moved on (today's render), but can't merge. Files are `current`,
  `refresh` (unchanged since written, template moved: safe to replace),
  `review` (both changed), `yours`, `deleted`, `dropped`, `new`, and
  `differs` for files efforge edits in place and so never hashed
  (`layers.ts`, `AGENTS.md`, `auth.ts`). A freshly created, installed and
  formatted project equals today's render byte for byte (checked), so
  `differs` is exact, not a formatting false alarm.
- `--patch` prints one git patch of every change that keeps the user's
  edits: guard, pins, missing dependencies/scripts/`engines`, seams, refreshed
  and new files, and their new hashes in efforge.jsonc (so a later `add`
  still treats them as efforge's). `git apply` refuses it if anything
  changed since. This makes the steps one command without efforge writing
  into a project; review files and scripts stay with the user, and
  `--diff | git apply --include=<file>` takes one of them whole.
- Exit code `2` means a check ran and found something (`drifted`, or a
  `doctor` check that failed); the document still has `ok: true`. `1` stays
  "the command failed". `drifted` is true exactly when a guard is missing or
  the patch is non-empty: a file the user edited, deleted or keeps
  differently never counts, so every project can reach `0` and a CI gate
  can't nag forever.
- `doctor` is a list of named checks (`checks` in `src/doctor.ts`), each a
  small unit with a stable `id`, run in order, a thrown check reported as
  failed. The add-on seam is the manifest, not a new field: `env` derives
  from each add-on's `envVars` and `addDevVar` transforms plus the
  `Config.*("NAME")` reads in the code, `bindings` from `addWranglerBinding`
  and `addAlchemyResource` transforms, `layers` from `addLayer`. An add-on
  that declares those gets its checks for free; an add-on that needs a check
  of its own adds an entry to `checks` (a `checks` field in `addon.json` can
  come later, when one needs it).
- `doctor` writes nothing and needs no network by default. The outside world
  (`node`, `pnpm --version`, `pnpm peers check`, a TCP connect to the local
  Postgres, the local D1 file) goes through `DoctorProbe`, so tests stub it.
  `pnpm` is asked its version from the filesystem root, where no
  `packageManager` switches it; `pnpm peers check` in the project is skipped
  when the pinned pnpm differs from the one on PATH (it may download), unless
  `--online`.

## Not done: a scheduled `upgrade --check` in generated projects

A weekly workflow in the template that runs `npx create-efforge@latest
upgrade --check` was considered and left out. It would run unpinned code from
npm on a schedule with the repository's token, fail the default branch for
pins that are merely behind (a nag, not a breakage), and need maintaining in
every project for a check one command already does. The failure it would
have caught in November 2026 is now caught in efforge's own repo
(`scripts/bump.ts`, the daily CI run, the e2e lockfile check). docs/cli.md
says how to add the step to your own CI if you want it.

## Consequences

- A template change shows up as `refresh` in every project made before it.
  That is the point, but a template edit that only reformats now costs
  users a step; keep template changes meaningful.
- A file the user edited *and* efforge's template changed shows as
  `review`, forever, until the user takes efforge's version or an apply
  records the new hash. It doesn't set the exit code.
- `differs` can't tell a user's edit of `auth.ts` from an older efforge's
  version of it. The step says so and shows the diff.
