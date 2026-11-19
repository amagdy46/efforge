# 0009 — `upgrade` compares a project with today's templates, `doctor` checks the checkout

Date: 2026-11-18, revised 2026-11-19. Status: accepted. How `upgrade` applies changes is
[0011](0011-upgrade-applies-what-efforge-can-prove.md).

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
  every generated file by bucket, seams, scripts, what it would keep and why,
  and ordered steps. It never writes; `upgrade` applies (ADR 0011).
- efforge.jsonc holds the hash of what efforge wrote, not the content, so
  efforge can tell *who* changed a file and whether the template moved on,
  but can't merge. For files efforge edits in place (`layers.ts`,
  `AGENTS.md`, `wrangler.jsonc`), which have no hash, it compares
  structure, not text: two versions are the same when they hold the same
  lines in any order (or, for JSONC, the same data), as `add` compares its
  own output. `add` appends a layer or a section where `create` puts it in
  slot order, so a project that ran `add` is not different for that. An
  earlier version of this ADR said the comparison was exact; it was a text
  comparison, and every project that ran `add` was reported as differing for
  good.
- Exit codes answer two questions apart. `2` means something breaks the
  project now (`needs-action`): a guard missing, a set half moved, an import
  that is broken, an install owed. `behind` (efforge has newer pins or
  templates the project could take) is `0`, or `3` with `--strict`. `1` stays
  "the command failed". Under `--json` the document has `ok: true` either way,
  and `status` says which.
- `doctor` is a list of named checks (`checks` in `src/doctor.ts`), each a
  small unit with a stable `id`, run in order, a thrown check reported as
  failed. The add-on seam is the manifest, not a new field: `env` derives
  from each add-on's `envVars` plus the `Config.*("NAME")` reads in the code,
  `bindings` from `addWranglerBinding` and `addAlchemyResource` transforms,
  `layers` from `addLayer`. An add-on that declares those gets its checks for
  free; one that needs a check of its own adds an entry to `checks`.
- A check's `fix` is a promise, like an error's: a command after which that
  check passes and no other check is worse, or `null` with the facts. For
  the `effect`, `effect-guard` and `upgrade` checks it is `upgrade` (which
  writes the guard and installs), or `null` when `upgrade` would refuse
  (uncommitted changes) or has nothing to apply. `test/fix-property.test.ts`
  follows each check's fix on broken projects and asserts the check then
  passes and nothing else got worse.
- `doctor` reads code as code: `layers` and the Alchemy `bindings` parse the
  file, so a commented-out layer is missing and `AppLayer` built from another
  const counts. Where it can't find the shape it knows (a layer of the
  owner's in place of efforge's, an `env` object built another way), the
  status is `unverified`, with what it looked for, not a failure.
- `doctor` writes nothing and needs no network by default. The outside world
  (`node`, `pnpm --version`, `pnpm peers check`, a TCP connect to the local
  Postgres, the local D1 file, `git status`) goes through `DoctorProbe`, so
  tests stub it. `pnpm` is asked its version from the system temp directory,
  where no `packageManager` switches it. `pnpm peers check` runs in the
  project when the pnpm on PATH is the pinned one, or when the pinned one
  made `node_modules` (`node_modules/.modules.yaml` says which), since then
  it is on this machine; otherwise it is skipped with the command to run it
  yourself, or `--online` runs it.

## Not done: a scheduled `upgrade --check` in generated projects

A workflow in the template that runs `upgrade --check` on a schedule was
considered and left out, for now.

What efforge's own CI does (`scripts/bump.ts`, the daily run, the e2e
lockfile check) tells efforge when its templates go stale. It tells an
existing project nothing: a project made last month learns that efforge has
moved on only when its owner runs a command. That is the gap a scheduled
check would close, and the promise ("the maintained way") is about that
project.

The obstacle was the exit code. Before ADR 0011, `2` meant both "this will
break" (a missing guard, two Effects) and "the templates moved", so any
schedule would fail the default branch every time efforge shipped a
template change, a nag rather than a warning. With two answers, a project
can gate on `needs-action` alone.

It would be worth shipping when it can run without failing a branch for
`behind`: a weekly workflow, off by default, that runs a pinned efforge,
fails only on `needs-action`, and for `behind` opens or updates one issue
with no write permission beyond that. Until then, an owner who wants it now
adds one step to their CI:

```sh
npx -y create-efforge@latest upgrade --check   # fails (exit 2) only when something breaks
```

## Consequences

- A template change shows up as `refresh` in every project made before it,
  and `upgrade` applies it where the file is still efforge's. A template
  edit that only reformats still costs every project a refresh; keep
  template changes meaningful.
- A file the owner edited *and* efforge's template changed is `review`
  until the owner takes efforge's version or the template moves back. It
  never sets the exit code.
