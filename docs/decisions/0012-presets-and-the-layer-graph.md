# 0012 — Presets are data that record nothing; the layer graph is read, not described

Date: 2026-11-19. Status: accepted.

## Context

`create` asked seven questions before it wrote anything. Most people want one of a few stacks,
and a coding agent told "start me a SaaS on Cloudflare" should not have to know which seven
flags make one. At the same time `efforge.jsonc` and the summary record a command that makes the
same project again, and that promise must hold across versions.

The generated app's dashboard already draws its layer graph: it reads `AppLayer` from
`apps/web/src/server/layers.ts` and annotates each layer from the capability cards' `layer`
field. A CLI command that prints the same graph could easily grow a third description of each
layer (the cards, the manifests, and now the CLI), and the three would drift.

## Decision

- Presets live in one place, `src/presets.ts`: an id, a title, a one-line description and a
  full stack. `create --preset=<id>` fills every slot no flag set. A flag always wins and is
  never dropped. A preset's choice that can't stand next to a flag is dropped (its slot becomes
  none, or it leaves the extras) and the run says so, as a line and a `--json` warning. A preset
  gives way only by leaving a part out: when a flag needs something neither it nor another flag
  gives (`--preset=minimal --auth=better-auth` needs a database), it is `IncompatibleStack` with
  alternatives, some of which change two flags (a database and an ORM). An earlier version took
  the default for a slot the flag ruled out, and it depended on slot order: `--database=none`
  silently dropped auth, while `--auth=better-auth` on minimal was an error. The prompt asks
  for a preset (or "choose each part") right after the name, so Back from the first slot returns
  to it; the name prompt cannot go back, so asking it first keeps the preset reachable. After a
  preset, the confirmation offers Change parts: every part again, with the preset's as the
  defaults, and the summary gives the flags that make the result (`--preset=saas
  --database=d1`), so a person learns the form an agent uses.
- Nothing records a preset's name. The summary, `command` in `efforge.jsonc` and the `--json`
  document give the stack flag by flag. A preset can change between versions (a new extra in
  `saas`); the recorded command keeps making the same project.
- Each preset must pass the stack rules, checked by a test. `saas` is the default stack plus
  email and storage; `ai` is D1, Effect SQL, Better Auth (users only, so `LLM_API_KEY` comes from
  the environment, the simplest key setup), the AI add-on and realtime; `minimal` has no
  database and no auth.
- `efforge graph` reads the layers from the project's `layers.ts` with ts-morph, as `add` does,
  and takes each layer's facts from the same places the dashboard does: the `layer` field of the
  project's own card modules (falling back to the add-on's card when the project lacks it), plus
  what `layers.ts` provides to a layer with `Layer.provide`. A layer without a card gets its
  service from the manifest's `guide.service` and its needs from the bindings and env vars the
  manifest declares. A layer no add-on adds is the user's: provides and needs are unknown, and
  the graph says so rather than guessing.
- The graph's colours come from the brand source: `pnpm brand` writes the tempering colours to
  `src/brand.ts` as node styles (a light tint behind Iron text, edged in the colour), so one
  Mermaid renders on GitHub light and dark.
- `graph --write` puts the graph in a README region, `efforge:readme:graph`, under the rules of
  ADR 0010: it never touches a README without markers or with broken ones. The region is opt-in;
  once it exists, `add` redraws it.

## Consequences

- Changing a preset is a one-line change, and does not break any recorded command.
- A layer added without an add-on shows "unknown" until the user adds a card with a `layer`
  field, which also puts it on the dashboard.
- A new README gets no graph region unless someone runs `graph --write`. Making it part of every
  new README is a later decision, and would change what `create` writes.
- `--verbose` is a `create` flag (the full dry-run list), so a command that also takes it can't
  use it to tell the bare root form from a create.
