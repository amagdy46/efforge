import { Effect } from "effect"
import type { Tree } from "../tree.ts"
import { ALCHEMY_FILE, addAlchemyResource } from "./addAlchemyResource.ts"
import { addArrayItem } from "./addArrayItem.ts"
import { AUTH_FILE, addAuthPlugin } from "./addAuthPlugin.ts"
import { addDevVar } from "./addDevVar.ts"
import { addExport } from "./addExport.ts"
import { addImport } from "./addImport.ts"
import { addLayer } from "./addLayer.ts"
import { addServerFnMiddleware } from "./addServerFnMiddleware.ts"
import { addWorkflowSecret, WORKFLOW_FILE } from "./addWorkflowSecret.ts"
import { addWranglerBinding, WRANGLER_FILE } from "./addWranglerBinding.ts"
import { AGENTS_FILE, appendAgentsSection } from "./appendAgentsSection.ts"
import { TransformAnchorMissing, UnknownTransform } from "./errors.ts"
import { setWranglerValue } from "./setWranglerValue.ts"
import type { Transform } from "./util.ts"

export type { Transform }
export { TransformAnchorMissing, UnknownTransform }

export interface TransformCall {
  readonly name: string
  readonly args: Readonly<Record<string, string>>
}

interface Entry {
  readonly run: Transform
  /** The files this transform reads or edits, so `add` can load them before running it. */
  readonly targets: (args: Readonly<Record<string, string>>) => string[]
}

const onFile = (args: Readonly<Record<string, string>>) =>
  args.file === undefined ? [] : [args.file]
const fixed = (file: string) => () => [file]

const registry: Readonly<Record<string, Entry>> = {
  addImport: { run: addImport, targets: onFile },
  addArrayItem: { run: addArrayItem, targets: onFile },
  addExport: { run: addExport, targets: onFile },
  addLayer: { run: addLayer, targets: onFile },
  addAuthPlugin: { run: addAuthPlugin, targets: fixed(AUTH_FILE) },
  appendAgentsSection: { run: appendAgentsSection, targets: fixed(AGENTS_FILE) },
  addAlchemyResource: { run: addAlchemyResource, targets: fixed(ALCHEMY_FILE) },
  addWorkflowSecret: { run: addWorkflowSecret, targets: fixed(WORKFLOW_FILE) },
  addWranglerBinding: { run: addWranglerBinding, targets: fixed(WRANGLER_FILE) },
  setWranglerValue: { run: setWranglerValue, targets: fixed(WRANGLER_FILE) },
  addServerFnMiddleware: { run: addServerFnMiddleware, targets: onFile },
  addDevVar: { run: addDevVar, targets: fixed(".dev.vars") },
}

const entry = (name: string): Entry | undefined =>
  Object.hasOwn(registry, name) ? registry[name] : undefined

/** Files a transform call may touch; unknown transforms have none (running them fails anyway). */
export const transformTargets = (t: TransformCall): string[] => entry(t.name)?.targets(t.args) ?? []

export const runTransform = (
  tree: Tree,
  t: TransformCall,
): Effect.Effect<Tree, TransformAnchorMissing | UnknownTransform> => {
  const fn = entry(t.name)
  return fn === undefined
    ? Effect.fail(new UnknownTransform({ name: t.name }))
    : fn.run(tree, t.args)
}
