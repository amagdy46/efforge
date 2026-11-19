import { Effect, FileSystem, Path } from "effect"
import { Node, SyntaxKind } from "ts-morph"
import { addonIdsFor, type LoadedAddon } from "./addon.ts"
import { diagram, temperNodes } from "./brand.ts"
import { CARDS_DIR } from "./cards.ts"
import { matches } from "./generate.ts"
import { closeMarker, type Filled, fillRegions, openMarker, parseRegions } from "./regions.ts"
import { README_PREFIX } from "./readme.ts"
import type { StackConfig } from "./stack.ts"
import { parseTs } from "./transforms/util.ts"

// The project's layer graph (`efforge graph`): the layers `AppLayer` merges in
// apps/web/src/server/layers.ts, read from the file as it is, joined with what the add-ons say
// about them. The facts are the ones the dashboard's layer graph shows: a capability card's
// `layer` ({ name, provides, needs }), read from the project's own card modules (or the
// add-on's, when the project has none), plus what layers.ts provides to a layer with
// `Layer.provide`. A layer without a card gets its service from the add-on's manifest and its needs
// from the bindings and settings the manifest declares. A layer no add-on adds is the user's: its
// provides and needs are unknown, and the graph says so.

export const LAYERS_FILE = "apps/web/src/server/layers.ts"

/** One argument of `AppLayer = Layer.mergeAll(...)`. */
export interface LayerEntry {
  /** The layer's name: `RealtimeLive`, `Logger.layer`, `DatabaseLayer` */
  readonly name: string
  /** The argument as written: `DatabaseLayer.pipe(Layer.provide(WorkerEnvLive))` */
  readonly expression: string
  /** What layers.ts provides to it with `Layer.provide(...)` */
  readonly provided: ReadonlyArray<string>
}

/**
 * The layers `AppLayer = Layer.mergeAll(...)` merges in `source`, in order; undefined when the
 * file has no such call (the user changed its shape).
 */
export const parseLayers = (source: string): LayerEntry[] | undefined => {
  const sf = parseTs(LAYERS_FILE, source)
  const call = sf
    .getVariableDeclaration("AppLayer")
    ?.getInitializer()
    ?.asKind(SyntaxKind.CallExpression)
  if (call === undefined || call.getExpression().getText() !== "Layer.mergeAll") return undefined
  return call.getArguments().map((arg) => {
    // `X.pipe(...)` is X; `Logger.layer([...])` is `Logger.layer`; anything else as written
    let head: Node = arg
    for (;;) {
      if (Node.isCallExpression(head)) {
        const callee = head.getExpression()
        head =
          Node.isPropertyAccessExpression(callee) && callee.getName() === "pipe"
            ? callee.getExpression()
            : callee
        continue
      }
      break
    }
    const provided = arg
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter((c) => /^Layer\.provide(?:Merge)?$/.test(c.getExpression().getText()))
      .flatMap((c) => c.getArguments().map((a) => a.getText()))
    return { name: head.getText().replace(/\s+/g, ""), expression: arg.getText(), provided }
  })
}

/** What a card says about its layer. */
export interface CardLayer {
  readonly provides: ReadonlyArray<string>
  readonly needs: ReadonlyArray<string>
}

const strings = (n: Node | undefined): string[] | undefined =>
  n !== undefined && Node.isArrayLiteralExpression(n)
    ? n.getElements().flatMap((e) => (Node.isStringLiteral(e) ? [e.getLiteralValue()] : []))
    : undefined

/** Every `layer: { name, provides, needs }` in the card modules `sources`, by layer name. */
export const cardLayers = (sources: ReadonlyMap<string, string>): Map<string, CardLayer> => {
  const out = new Map<string, CardLayer>()
  for (const [file, text] of sources) {
    const sf = parseTs(file, text)
    for (const prop of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
      if (prop.getName() !== "layer") continue
      const value = prop.getInitializer()
      if (value === undefined || !Node.isObjectLiteralExpression(value)) continue
      const get = (key: string) =>
        value.getProperty(key)?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer()
      const name = get("name")
      const provides = strings(get("provides"))
      const needs = strings(get("needs"))
      if (name === undefined || !Node.isStringLiteral(name) || provides === undefined) continue
      out.set(name.getLiteralValue(), { provides, needs: needs ?? [] })
    }
  }
  return out
}

/** A layer in the graph. `provides` and `needs` are null for a layer no add-on adds. */
export interface GraphLayer {
  readonly name: string
  readonly expression: string
  /** The add-on that adds it (`base` for the logger), or null for your own. */
  readonly addon: string | null
  readonly provides: ReadonlyArray<string> | null
  readonly needs: ReadonlyArray<string> | null
  /** Its tempering colour, by its place in the list. */
  readonly color: string
}

export interface LayerGraph {
  readonly file: string
  readonly layers: ReadonlyArray<GraphLayer>
}

/** The bindings and settings an add-on's manifest declares for `stack`, as a layer's needs. */
const manifestNeeds = (addon: LoadedAddon, stack: StackConfig): string[] => {
  const m = addon.manifest
  // a binding is declared once per infra; either says what the layer reads
  const asWrangler = { ...stack, infra: "none" } as StackConfig
  const bindings = m.transforms
    .filter((t) => t.name === "addWranglerBinding" && matches(t.when, asWrangler))
    .filter((t) => !["migrations", "containers"].includes(t.args.key ?? ""))
    .flatMap((t) => {
      try {
        const v = JSON.parse(t.args.value ?? "") as { binding?: string; name?: string }
        const name = v.binding ?? v.name
        return name === undefined ? [] : [`${name} binding`]
      } catch {
        return []
      }
    })
  const env = m.envVars.filter((v) => matches(v.when, stack)).map((v) => v.name)
  return [...new Set([...bindings, ...env])]
}

/** The name an add-on's `addLayer` gives its layer: `DatabaseLayer.pipe(...)` -> `DatabaseLayer`. */
const layerNameOf = (layer: string): string =>
  /^[\w$.]+/.exec(layer)?.[0].replace(/\.pipe$/, "") ?? layer

/**
 * The graph of `layers` (from layers.ts) for `stack`: each layer's add-on, what it provides and
 * needs. `cards` are the card modules to read layer facts from, by path.
 */
export const layerGraph = (o: {
  readonly layers: ReadonlyArray<LayerEntry>
  readonly stack: StackConfig
  readonly addons: ReadonlyMap<string, LoadedAddon>
  readonly cards: ReadonlyMap<string, string>
}): LayerGraph => {
  const facts = cardLayers(o.cards)
  const owners = new Map<string, LoadedAddon>()
  for (const id of addonIdsFor(o.stack)) {
    const a = o.addons.get(id)
    for (const t of a?.manifest.transforms ?? [])
      if (t.name === "addLayer" && t.args.layer !== undefined && matches(t.when, o.stack))
        owners.set(layerNameOf(t.args.layer), a as LoadedAddon)
  }
  return {
    file: LAYERS_FILE,
    layers: o.layers.map((l, i) => {
      const color = (temperNodes[i % temperNodes.length] as (typeof temperNodes)[number]).name
      const card = facts.get(l.name)
      const owner = owners.get(l.name)
      const addon = owner?.manifest.id ?? (card === undefined ? null : "base")
      if (card === undefined && owner === undefined)
        return {
          name: l.name,
          expression: l.expression,
          addon: null,
          provides: null,
          needs: null,
          color,
        }
      const service = owner?.manifest.guide?.service?.name
      const provides = card?.provides ?? (service === undefined ? [] : [service])
      const needs = card?.needs ?? (owner === undefined ? [] : manifestNeeds(owner, o.stack))
      return {
        name: l.name,
        expression: l.expression,
        addon,
        provides,
        needs: [...new Set([...l.provided, ...needs])],
        color,
      }
    }),
  }
}

/**
 * The card modules to read layer facts from: the project's own (`read` lists and reads its
 * capabilities directory), and for a card module the project doesn't have, the add-on's.
 */
export const cardSources = (
  stack: StackConfig,
  addons: ReadonlyMap<string, LoadedAddon>,
  project: ReadonlyMap<string, string>,
): Effect.Effect<Map<string, string>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const out = new Map(project)
    for (const id of addonIdsFor(stack)) {
      const a = addons.get(id)
      if (a === undefined) continue
      for (const f of [...a.manifest.files, ...(a.manifest.card?.files ?? [])]) {
        if (!f.target.startsWith(CARDS_DIR) || !f.target.endsWith(".tsx")) continue
        if (out.has(f.target) || !matches(f.when, stack)) continue
        const text = yield* fs
          .readFileString(path.join(a.dir, f.path))
          .pipe(Effect.orElseSucceed(() => undefined))
        if (text !== undefined) out.set(f.target, text)
      }
    }
    return out
  })

/** The card modules in a project directory, by path. */
export const projectCards = (
  dir: string,
  read: (rel: string) => Effect.Effect<string | undefined>,
): Effect.Effect<Map<string, string>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const names = yield* fs
      .readDirectory(path.join(dir, CARDS_DIR))
      .pipe(Effect.orElseSucceed(() => [] as string[]))
    const out = new Map<string, string>()
    for (const name of names.filter((n) => n.endsWith(".tsx")).toSorted()) {
      const text = yield* read(`${CARDS_DIR}${name}`)
      if (text !== undefined) out.set(`${CARDS_DIR}${name}`, text)
    }
    return out
  })

// --- Rendering ---------------------------------------------------------------------------

/** Text for a Mermaid label: quotes and markup characters as entities. */
const label = (s: string) =>
  s.replace(/&/g, "#amp;").replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;")

const style = (c: { readonly fill: string; readonly stroke: string; readonly ink: string }) =>
  `fill:${c.fill},stroke:${c.stroke},color:${c.ink}`

/** Node ids and edges: `app`, `l<i>` per layer, `n<i>` per distinct need. */
export const graphNodes = (g: LayerGraph) => {
  const needs = [...new Set(g.layers.flatMap((l) => l.needs ?? []))]
  const needId = (n: string) => `n${needs.indexOf(n)}`
  return {
    nodes: [
      { id: "app", kind: "app" as const, label: "AppLayer" },
      ...g.layers.map((l, i) => ({ id: `l${i}`, kind: "layer" as const, label: l.name })),
      ...needs.map((n) => ({ id: needId(n), kind: "need" as const, label: n })),
    ],
    edges: [
      ...g.layers.map((_, i) => ({ from: `l${i}`, to: "app", kind: "merges" as const })),
      ...g.layers.flatMap((l, i) =>
        (l.needs ?? []).map((n) => ({ from: needId(n), to: `l${i}`, kind: "needs" as const })),
      ),
    ],
  }
}

/**
 * The graph as a Mermaid flowchart: what each layer needs, left; the layers, each in its
 * tempering colour with what it provides; `AppLayer`, right. Renders on GitHub, light and dark.
 */
export const mermaid = (g: LayerGraph): string => {
  const { nodes, edges } = graphNodes(g)
  const lines = ["flowchart LR"]
  for (const n of nodes) {
    if (n.kind === "app") lines.push(`  app[["AppLayer<br/>${label(g.file)}"]]:::app`)
    else if (n.kind === "need") lines.push(`  ${n.id}(["${label(n.label)}"]):::need`)
    else {
      const i = Number(n.id.slice(1))
      const l = g.layers[i] as GraphLayer
      const provides =
        l.provides === null ? "provides: unknown" : `provides ${l.provides.join(", ") || "nothing"}`
      lines.push(
        `  ${n.id}["<b>${label(l.name)}</b><br/>${label(provides)}"]:::t${(i % temperNodes.length) + 1}`,
      )
    }
  }
  for (const e of edges) lines.push(`  ${e.from} ${e.kind === "merges" ? "-->" : "-.->"} ${e.to}`)
  // the styles this graph uses
  temperNodes
    .slice(0, g.layers.length)
    .forEach((c, i) => lines.push(`  classDef t${i + 1} ${style(c)},stroke-width:2px`))
  lines.push(`  classDef app ${style(diagram.app)}`)
  if (nodes.some((n) => n.kind === "need")) lines.push(`  classDef need ${style(diagram.need)}`)
  return lines.join("\n")
}

/** The graph as an indented list, for a terminal or an agent. */
export const textGraph = (g: LayerGraph): string => {
  const width = Math.max(...g.layers.map((l) => l.name.length), 0)
  const out = [`AppLayer  (${g.file})`]
  g.layers.forEach((l, i) => {
    const last = i === g.layers.length - 1
    const branch = last ? "└─" : "├─"
    const rest = last ? "   " : "│  "
    out.push(`${branch} ${l.name.padEnd(width)}  ${l.addon ?? "your own layer"}`)
    out.push(
      `${rest}   provides  ${l.provides === null ? "unknown" : l.provides.join(", ") || "nothing"}`,
    )
    out.push(
      `${rest}   needs     ${l.needs === null ? "unknown" : l.needs.join(", ") || "nothing"}`,
    )
  })
  return out.join("\n")
}

// --- The README region ------------------------------------------------------------------

/** The README region `graph --write` fills: like the others, between efforge:readme markers. */
export const GRAPH_REGION = "graph"

/** The body of the graph region. */
export const graphRegion = (g: LayerGraph): string =>
  [
    "How the server's layers fit together, from `apps/web/src/server/layers.ts`. `npx create-efforge graph --write` redraws it, and `efforge add` keeps it current.",
    "",
    "```mermaid",
    mermaid(g),
    "```",
  ].join("\n")

/**
 * `readme` with the graph region filled. A README that has the region gets its body replaced; one
 * that has the other efforge:readme regions but not this one gets it after the capabilities
 * region (else after the last). A README without markers, or with broken ones, is left alone.
 */
export const writeGraph = (readme: string, g: LayerGraph): Filled => {
  const parsed = parseRegions(readme, README_PREFIX)
  if (!parsed.ok) return { kind: "malformed", problems: parsed.problems }
  if (parsed.regions.length === 0) return { kind: "no-markers" }
  const content = graphRegion(g)
  if (parsed.regions.some((r) => r.id === GRAPH_REGION))
    return fillRegions(readme, README_PREFIX, { [GRAPH_REGION]: content })
  const after = parsed.regions.find((r) => r.id === "capabilities") ?? parsed.regions.at(-1)
  if (after === undefined) return { kind: "no-markers" }
  const cr = parsed.eol === "\r\n" ? "\r" : ""
  const lines = [...parsed.lines]
  lines.splice(
    after.close + 1,
    0,
    cr,
    `## Layer graph${cr}`,
    cr,
    `${openMarker(README_PREFIX, GRAPH_REGION)}${cr}`,
    `${closeMarker(README_PREFIX, GRAPH_REGION)}${cr}`,
  )
  return fillRegions(lines.join("\n"), README_PREFIX, { [GRAPH_REGION]: content })
}
