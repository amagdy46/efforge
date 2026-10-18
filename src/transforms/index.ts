import { Effect } from "effect"
import type { Tree } from "../tree.ts"
import { addAlchemyResource } from "./addAlchemyResource.ts"
import { addArrayItem } from "./addArrayItem.ts"
import { addAuthPlugin } from "./addAuthPlugin.ts"
import { addExport } from "./addExport.ts"
import { addImport } from "./addImport.ts"
import { addLayer } from "./addLayer.ts"
import { addWranglerBinding } from "./addWranglerBinding.ts"
import { appendAgentsSection } from "./appendAgentsSection.ts"
import { TransformAnchorMissing, UnknownTransform } from "./errors.ts"
import { setWranglerValue } from "./setWranglerValue.ts"
import type { Transform } from "./util.ts"

export type { Transform }
export { TransformAnchorMissing, UnknownTransform }

export interface TransformCall {
  readonly name: string
  readonly args: Readonly<Record<string, string>>
}

const registry: Readonly<Record<string, Transform>> = {
  addImport,
  addArrayItem,
  addExport,
  addLayer,
  addAuthPlugin,
  appendAgentsSection,
  addAlchemyResource,
  addWranglerBinding,
  setWranglerValue,
}

export const runTransform = (
  tree: Tree,
  t: TransformCall,
): Effect.Effect<Tree, TransformAnchorMissing | UnknownTransform> => {
  const fn = Object.hasOwn(registry, t.name) ? registry[t.name] : undefined
  return fn === undefined ? Effect.fail(new UnknownTransform({ name: t.name })) : fn(tree, t.args)
}
