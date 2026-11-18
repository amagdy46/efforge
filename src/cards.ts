import type { AddonManifest, When } from "./addon.ts"
import type { TransformCall } from "./transforms/index.ts"

/** Where capability cards live in a generated project (docs/capability-cards.md). */
export const CARDS_DIR = "apps/web/src/capabilities/"

/** The dashboard renders this list; efforge appends each add-on's card to it. */
export const REGISTRY_FILE = `${CARDS_DIR}registry.ts`

/** `capabilities/realtime.tsx` -> `./realtime`, the specifier the registry imports it by. */
const specifier = (target: string): string =>
  `./${target.slice(CARDS_DIR.length).replace(/\.tsx?$/, "")}`

/**
 * The transform that registers the add-on's card in the registry: none without a card. It applies
 * when the card module does (`card.files[0].when`).
 */
export const cardRegistration = (
  manifest: AddonManifest,
): Array<TransformCall & { readonly when?: When }> => {
  const module = manifest.card?.files[0]
  if (manifest.card === undefined || module === undefined) return []
  const name = manifest.card.export
  return [
    {
      name: "addArrayItem",
      args: {
        file: REGISTRY_FILE,
        name: "capabilities",
        item: name,
        import: name,
        from: specifier(module.target),
      },
      ...(module.when === undefined ? {} : { when: module.when }),
    },
  ]
}
