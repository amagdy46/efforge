import { posix } from "node:path"
import type { AddonFile, AddonManifest, When } from "./addon.ts"
import { slots } from "./slots.ts"
import { type TransformCall, transformTargets } from "./transforms/index.ts"

/** Where capability cards live in a generated project (docs/capability-cards.md). */
export const CARDS_DIR = "apps/web/src/capabilities/"

/** The dashboard renders this list; efforge appends each add-on's card to it. */
export const REGISTRY_FILE = `${CARDS_DIR}registry.ts`

/** A card's server functions live in its files here; efforge guards each one on auth stacks. */
export const SERVER_DIR = "apps/web/src/server/"

/** Every auth option: each provides `requireSession` in apps/web/src/server/require-session.ts. */
const AUTH_OPTIONS = (slots.find((s) => s.id === "auth")?.options ?? [])
  .map((o) => o.id)
  .filter((id) => id !== "none")

type CardTransform = TransformCall & { readonly when?: When }

/** Where `requireSession` lives on auth stacks. */
const GUARD_FILE = `${SERVER_DIR}require-session.ts`

/**
 * The server functions a signed-out visitor must reach, by file. Every other server function in
 * apps/web requires a session on auth stacks: efforge adds the guard to add-on files, and the
 * generated project's lint rule (`efforge/server-fn-session`, configured with this same list in
 * templates/base/files/root/vite.config.ts) fails on any it does not see.
 */
export const PUBLIC_SERVER_FNS: Readonly<Record<string, ReadonlyArray<string>>> = {
  [`${SERVER_DIR}session.ts`]: ["getSession", "getAppState"],
  [`${SERVER_DIR}stack.ts`]: ["getStack"],
}

/** Whether efforge guards the server functions of a file with `source`, at `target`, on auth stacks. */
export const needsGuard = (target: string, source: string): boolean =>
  target.startsWith("apps/web/src/") &&
  /\.tsx?$/.test(target) &&
  !Object.hasOwn(PUBLIC_SERVER_FNS, target) &&
  /\bcreateServerFn\s*\(/.test(source)

/**
 * `requireSession` on every server function in `file`, on auth stacks only. A file that no longer
 * has a server function (the user rewrote it) is left alone.
 */
export const sessionGuard = (file: Pick<AddonFile, "target" | "when">): CardTransform => {
  const from = posix.relative(posix.dirname(file.target), GUARD_FILE.replace(/\.ts$/, ""))
  return {
    name: "addServerFnMiddleware",
    args: {
      file: file.target,
      middleware: "requireSession",
      import: "requireSession",
      from: from.startsWith(".") ? from : `./${from}`,
      ifAny: "true",
    },
    when: withAuth(file.when),
  }
}

/** `capabilities/realtime.tsx` -> `./realtime`, the specifier the registry imports it by. */
const specifier = (target: string): string =>
  `./${target.slice(CARDS_DIR.length).replace(/\.tsx?$/, "")}`

/** `when`, narrowed to stacks with auth. */
const withAuth = (when: When | undefined): When => {
  const auth = when?.auth?.filter((a) => AUTH_OPTIONS.includes(a)) ?? AUTH_OPTIONS
  return { ...when, auth }
}

/**
 * What efforge does to a project with the add-on's card, after writing `card.files`, in order: the
 * card's own transforms; on auth stacks, `requireSession` on every server function in the card's
 * files under apps/web/src/server/ (a card author never writes that guard); and the registration
 * of the card in the registry. None without a card.
 *
 * These are one unit with the card's files: `add` applies them only where the project has the
 * registry, and each only to card files that are there (written now, or on disk). A transform
 * whose `when` switches on later (auth added after the card) runs then, like any other.
 */
export const cardTransforms = (manifest: AddonManifest): CardTransform[] => {
  const card = manifest.card
  const module = card?.files[0]
  if (card === undefined || module === undefined) return []
  const guards = card.files
    .filter((f) => f !== module && f.target.startsWith(SERVER_DIR))
    .map(sessionGuard)
  const registration: CardTransform = {
    name: "addArrayItem",
    args: {
      file: REGISTRY_FILE,
      name: "capabilities",
      item: card.export,
      import: card.export,
      from: specifier(module.target),
    },
    ...(module.when === undefined ? {} : { when: module.when }),
  }
  return [...(card.transforms ?? []), ...guards, registration]
}

/**
 * The add-on's card transforms that apply to a project, given which files it has (`has`): none
 * without the registry or the card module, and each only when the files it edits are there.
 */
export const presentCardTransforms = (
  manifest: AddonManifest,
  has: (file: string) => boolean,
): CardTransform[] => {
  const module = manifest.card?.files[0]?.target
  if (module === undefined || !has(module) || !has(REGISTRY_FILE)) return []
  return cardTransforms(manifest).filter((t) => transformTargets(t).every(has))
}
