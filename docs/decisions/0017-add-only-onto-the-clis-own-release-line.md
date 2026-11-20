# 0017 — `add` writes only onto a project from its own release line

Date: 2026-11-20. Status: accepted. Replaces the card-less `add` on 0.2.x projects in
[0008](0008-capability-cards.md) and the card-boundary check `add` had before this.

## Context

`add` used to try to fit an add-on onto any project. A project from before the cards (0.2.x) got
the add-on without its card and a note; a project whose `outcome.ts` predated server functions
returning an `Exit` was refused with `UpgradeFirst`, found by reading that file.

The final pass before 0.3.0 found where that ends. `add rpc` on a 0.2.0 or 0.2.1 project answered
`ok: true` with no warning, because these projects have no `outcome.ts` at all, so the check never
fired. The rpc files import files only 0.3.0 projects have, and the add put 4.0.5-era Effect pins
beside packages that need 4.1. On 0.2.0, following the documented recovery (commit, `upgrade`)
left `pnpm build` failing while `upgrade`, `doctor` and `upgrade --check --strict` all said the
project was current: `upgrade` read the pins `add` had written as the owner's.

Every add-on is written against what its own release generates: the card boundary, the base files,
the pins and the overrides. Sniffing for each thing an add-on needs means one sniff per need, and
a missing one is a project that does not build.

## Decision

- `add` reads `efforgeVersion` from `efforge.jsonc` before it computes anything. When it is older
  than `addFloor()`, it writes nothing and answers `UpgradeFirst` with `version`, `needs` and
  `addons`; `fix` is `upgrade` in the same project and `after` the same `add`.
- `addFloor()` (`src/history.ts`) is the first recorded release of the CLI's own line: its minor
  before 1.0 (0.3.0 for any 0.3.x), its major after. It comes from the release history and the
  CLI's version, so the next release keeps the rule without anyone changing it: 0.4.0 will refuse
  a 0.3.x project until it is upgraded.
- A patch release whose add-ons need something earlier releases of its line did not generate is a
  minor release instead.
- `add` no longer reads `outcome.ts` to decide. A project of the CLI's line without a card registry
  (its dashboard removed, or the registry held back by `upgrade`) still gets an add-on without its
  card, with a note that says why.

## Consequences

- A 0.2.x owner runs `upgrade` before any `add`. The CHANGELOG's upgrade section says so, and the
  e2e suite runs the refused `add`, `upgrade` and the same `add` on real 0.2.0 and 0.2.1 projects,
  then their gate.
- A project upgraded by a newer patch of the same line is never refused; a project made by a
  newer efforge than the CLI keeps its existing warning (`add`) and refusal (`upgrade`).
- An unreleased build's projects record the version in `package.json` at the time; an
  unparseable version is not refused.
