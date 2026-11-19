import type { LoadedAddon } from "./addon.ts"
import { addonIdsFor } from "./addon.ts"
import { matches } from "./generate.ts"
import { type Section, type Synced, syncSections } from "./regions.ts"
import type { StackConfig } from "./stack.ts"

/**
 * AGENTS.md has a section per add-on fact, between `<!-- efforge:section:<id> -->` and
 * `<!-- /efforge:section:<id> -->`, above the `<!-- efforge:agents -->` footer. They are written
 * from the stack, the way the README's regions are: `create` and every `add` rewrite them in the
 * add-ons' order, and drop one that no longer holds (the `wrangler.jsonc` line once Alchemy
 * declares the Worker). Text outside them is the user's.
 */
export const AGENTS_PREFIX = "efforge:section"
export const AGENTS_FOOTER = "<!-- efforge:agents -->"

/** The sections a stack's AGENTS.md has, in order: each add-on's `appendAgentsSection` that applies. */
export const agentsSections = (
  stack: StackConfig,
  addons: ReadonlyMap<string, LoadedAddon>,
): Section[] => {
  const out: Section[] = []
  const seen = new Set<string>()
  for (const id of addonIdsFor(stack))
    for (const t of addons.get(id)?.manifest.transforms ?? []) {
      if (t.name !== "appendAgentsSection" || !matches(t.when, stack)) continue
      const sid = t.args.id
      if (sid === undefined || seen.has(sid)) continue
      seen.add(sid)
      out.push({ id: sid, content: t.args.content ?? "" })
    }
  return out
}

/** Every section id some add-on writes: the ones `syncAgents` may remove. */
const ownedIds = (addons: ReadonlyMap<string, LoadedAddon>): Set<string> =>
  new Set(
    [...addons.values()].flatMap((a) =>
      a.manifest.transforms.flatMap((t) =>
        t.name === "appendAgentsSection" && t.args.id !== undefined ? [t.args.id] : [],
      ),
    ),
  )

/** `text` (an AGENTS.md) with its sections brought to the stack. */
export const syncAgents = (
  text: string,
  stack: StackConfig,
  addons: ReadonlyMap<string, LoadedAddon>,
): Synced => {
  const owned = ownedIds(addons)
  return syncSections(text, AGENTS_PREFIX, agentsSections(stack, addons), {
    footer: AGENTS_FOOTER,
    owned: (id) => owned.has(id),
  })
}

/** The one-line note `add` prints when it leaves AGENTS.md as it is. */
export const agentsNote = (problems: ReadonlyArray<string>): string =>
  `AGENTS.md was left as it is: ${problems.join("; ")}. Keep one opening and one closing marker per section, each on a line of its own; the next efforge add rewrites the sections.`
