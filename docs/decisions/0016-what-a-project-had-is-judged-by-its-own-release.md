# 0016 — "Missing" is judged by the release a project or file came from

Date: 2026-11-20. Status: accepted. Refines [0011](0011-upgrade-applies-what-efforge-can-prove.md).

## Context

`upgrade` reads the release history (`src/history.data.ts`) two ways. One asks whether something
on disk is efforge's: a pin, a script command, a line of a file efforge edits in place. Any release
since the project's own may have written it, since an `add` from a newer efforge writes that
release's output. The other asks whether something missing was removed by the owner: a script, a
dependency, an in-place file, a stretch of lines. Both used every release since the project's.

That held only while the running efforge was not in the history yet. Recording 0.3.0 at release
time made everything 0.3.0 generates for the first time "written by a release", so on a 0.2.0
project the new scripts, dependencies and in-place files read as removed by the owner, and its
unedited `layers.ts`, `auth.ts`, `routes.ts` and `AGENTS.md` read as edited, since they lack 0.3.0's
new lines. Four upgrade tests failed on the release commit.

Two more cases came from the same root. A file `upgrade` held back keeps an older release's text
after `efforge.jsonc` records the new version, so on the next run it was judged against the new
release and read as edited. And an in-place file held back before it was ever written
(`capabilities/registry.ts`, which a 0.2.0 project with an edited dashboard does not get until the
owner merges the dashboard) read as a file the owner deleted, so it never arrived.

## Decision

- Whether something on disk is efforge's is still judged against every release since the
  project's, plus the release an in-place file's text came from.
- Whether something missing was removed is judged against what the project had:
  - scripts, dependencies, `engines`, workspace packages and in-place files: the project's own
    release, the newest record at or before its `efforgeVersion` (`ownRelease`);
  - lines of an in-place file: the release whose output the file is, the one that wrote the most
    of it, the newest on a tie (`sourceRecordFor`). In-place files have no hash, so their text is
    the only evidence of where they came from.
- `upgrade` records in `efforge.jsonc` under `held` the in-place files it held back before writing
  them, and clears the list when they arrive. `efforgeVersion` still moves to the running efforge,
  so an older efforge keeps refusing the project.

## Consequences

- At every release, recording the release no longer changes what `upgrade` does for older
  projects. `test/record.test.ts` holds this for whatever release is newest, and the 0.2.0 fixture
  tests in `test/upgrade.test.ts` run with 0.3.0 recorded.
- A line, script or dependency that an `add` from a newer efforge wrote, and that the owner then
  removed, is put back by the next `upgrade`: the project's records don't say an `add` ran. This
  is the safe direction, and the diff shows it.
- `efforge.jsonc` gains an optional field. The schema allows it, and older readers ignore it.
