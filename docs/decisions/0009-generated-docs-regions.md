# 0009 — The generated README and AGENTS.md are the user's files with regions efforge owns

Date: 2026-11-18. Status: accepted.

## Context

A generated project's `README.md` and `AGENTS.md` are the first files a person or a coding
agent opens. They must describe the stack the project has, and stay true after `efforge add`
changes it. They are also the files users edit most: a team rewrites the intro, adds its own
notes, renames a heading. A generator that loses one line of that will not be trusted again.

The first version (0.3 development) found a region with the first `indexOf` of its opening
marker and the next closing one. A marker quoted in prose, a duplicated marker, or a missing
closing marker with another pair below made `add` delete the user's text between them. Its
"Run it" region also depended on whether an untracked `.dev.vars` existed where `add` ran, so a
fresh clone rewrote a committed README differently from the machine that ran `create`.

## Decision

- A region is the lines between `<!-- <prefix>:<id> -->` and `<!-- /<prefix>:<id> -->`:
  `efforge:readme` in the README (about, run, scripts, layout, capabilities, deploy, more), and
  `efforge:section` in AGENTS.md. Inside a region the text is efforge's; every byte outside one
  is the user's and is never lost, duplicated or reordered.
- One parser (`src/regions.ts`) for both files. A marker counts only on a line of its own; a
  marker inside a sentence is prose. Each id has exactly one opening and one closing marker, the
  opening first, and regions don't nest. If any region breaks that, the whole file is left as it
  is and `add` names the marker in a note (text output, and `notes` under `--json`). Deleting a
  pair opts that section out.
- A region's content is a pure function of the stack in `efforge.jsonc` and the committed files
  efforge reads (the root `package.json` scripts), never of untracked files (`.dev.vars`, `.env`,
  `node_modules`). `create` writes the regions, every `add` rewrites them, and the result equals
  what `create` writes for the new stack.
- AGENTS.md sections are written from the stack the same way: each add-on's
  `appendAgentsSection` entries that apply, in the add-ons' order, above the
  `<!-- efforge:agents -->` footer. A section that no longer applies (the `wrangler.jsonc` line
  once Alchemy declares the Worker) is removed; a new one goes next to its neighbours. Sections
  written before they had closing markers (projects from efforge 0.2) can't be rewritten without
  guessing where they end: `add` only appends the missing ones, in the same old form.
- The README and AGENTS.md are seams: `efforge.jsonc` doesn't hash them, since every `add`
  rewrites their regions.
- What to run next has one source, `runSteps` in `src/readme.ts`: `create`'s and `add`'s printed
  steps, their `--json` `nextSteps` and the README's "Run it".
- Local settings have one file per stack: `.dev.vars` with wrangler, `.env` with Alchemy (the
  file `alchemy dev` reads). `addon.json` gives each env var its local value (`dev`), or none
  for a real secret. efforge writes that file and `.env.example` with the same lines at `create`
  and at every `add`; `add infra/alchemy` moves `.dev.vars` to `.env`. A fresh clone copies
  `.env.example` and fills in the secrets it names; nobody copies between two local files.
- A seeded property test (`test/regions.test.ts`) generates files with random user text and
  random marker damage and holds the parser to the rules above.

## Consequences

- A user can write anywhere outside the markers, rename every heading, and reorder sections.
- A broken marker stops all rewriting of that file until it is fixed, by design: guessing is how
  text was lost. The note says which marker and on which line.
- Renaming the markers later needs a migration in `add`.
- Per-add-on deploy text lives in `src/readme.ts`, not in `addon.json`; a new add-on that needs a
  deploy step must add it there.
- `.env.example` now holds local values (and `BETTER_AUTH_URL` empty), not production examples:
  production values go in `.env.production` (the README's Deploy section). Projects made before
  0.3 keep their old `.env.example`; `add` appends to it.
