import { Console, Effect, FileSystem, Path, Schema } from "effect"
import { Command, Flag } from "effect/cli"
import pc from "picocolors"
import { loadAddons } from "../addon.ts"
import { BIN, type Failure, Invocation, printSuccess, report } from "../contract.ts"
import {
  cardSources,
  graphNodes,
  LAYERS_FILE,
  layerGraph,
  mermaid,
  parseLayers,
  projectCards,
  textGraph,
  writeGraph,
} from "../graph.ts"
import { introLine } from "../intro.ts"
import { README_FILE, readmeNote } from "../readme.ts"
import { addFailure, readManifest } from "./add.ts"
import { TemplatesDir } from "./create.ts"

/** layers.ts is missing, or has no `AppLayer = Layer.mergeAll(...)` to read. */
export class LayersUnreadable extends Schema.TaggedError<LayersUnreadable>()("LayersUnreadable", {
  file: Schema.String,
  reason: Schema.String,
}) {}

/** `--write` found no README regions to write the graph into, or broken ones. */
export class ReadmeUnwritable extends Schema.TaggedError<ReadmeUnwritable>()("ReadmeUnwritable", {
  problems: Schema.Array(Schema.String),
}) {}

/** The project's layer graph, read from its files. */
export const projectGraph = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const manifest = yield* readManifest(dir)
    const read = (rel: string) =>
      fs.readFileString(path.join(dir, rel)).pipe(Effect.orElseSucceed(() => undefined))
    const source = yield* read(LAYERS_FILE)
    if (source === undefined)
      return yield* new LayersUnreadable({ file: LAYERS_FILE, reason: "the file is missing" })
    const layers = parseLayers(source)
    if (layers === undefined)
      return yield* new LayersUnreadable({
        file: LAYERS_FILE,
        reason: "it has no `export const AppLayer = Layer.mergeAll(...)`",
      })
    const addons = yield* loadAddons(yield* TemplatesDir)
    const cards = yield* cardSources(manifest.stack, addons, yield* projectCards(dir, read))
    return { graph: layerGraph({ layers, stack: manifest.stack, addons, cards }), read }
  })

const formats = ["mermaid", "text"] as const

/** What went wrong in `graph`, as the contract reports it. */
export const graphFailure = (
  e: { readonly _tag: string; readonly message?: string } & Record<string, unknown>,
  args: ReadonlyArray<string>,
): Failure => {
  switch (e._tag) {
    case "LayersUnreadable":
      return {
        code: "LayersUnreadable",
        message: `Can't read the layer graph from ${String(e.file)}: ${String(e.reason)}. efforge add keeps that call; put it back to see the graph.`,
        fix: null,
        details: { file: String(e.file), reason: String(e.reason) },
      }
    case "ReadmeUnwritable": {
      const problems = e.problems as string[]
      return {
        code: "ReadmeUnwritable",
        message: `${problems.join("; ")}. Nothing was written. Fix the markers, or paste the output of ${BIN} graph where you want it.`,
        fix: null,
        details: { file: README_FILE, problems },
      }
    }
    default:
      return addFailure(e, args)
  }
}

export const graphCommand = Command.make(
  "graph",
  {
    format: Flag.Literals("format", formats).pipe(
      Flag.withDescription("mermaid (default: pastes into a README or an issue) or text"),
      Flag.withDefault("mermaid" as const),
    ),
    write: Flag.Boolean("write").pipe(
      Flag.withDescription(
        "Write the Mermaid graph into README.md, between efforge:readme:graph markers",
      ),
      Flag.withDefault(false),
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription(
        "Print one JSON document on stdout, nothing else (https://github.com/amagdy46/efforge/blob/main/docs/json.md)",
      ),
      Flag.withDefault(false),
    ),
    cwd: Flag.String("cwd").pipe(
      Flag.withDescription("Project directory (default: current directory)"),
      Flag.withDefault("."),
    ),
  },
  (input) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const dir = path.resolve(input.cwd)
      const { graph, read } = yield* projectGraph(dir)
      let written: string | null = null
      if (input.write) {
        const readme = yield* read(README_FILE)
        if (readme === undefined)
          return yield* new ReadmeUnwritable({ problems: [`${README_FILE} doesn't exist`] })
        const filled = writeGraph(readme, graph)
        if (filled.kind !== "filled")
          return yield* new ReadmeUnwritable({ problems: [readmeNote(filled).replace(/\.$/, "")] })
        if (filled.text !== readme)
          yield* fs.writeFileString(path.join(dir, README_FILE), filled.text).pipe(Effect.orDie)
        written = README_FILE
      }
      if (input.json)
        return yield* printSuccess({
          directory: dir,
          file: graph.file,
          layers: graph.layers,
          ...graphNodes(graph),
          mermaid: mermaid(graph),
          written,
        })
      const body = input.format === "text" ? textGraph(graph) : mermaid(graph)
      // in a pipe, stdout carries only the graph, ready to redirect into a file
      if (!process.stdout.isTTY) return yield* Console.log(body)
      const lines = [introLine("graph"), "", body]
      if (written !== null)
        lines.push("", pc.dim(`Wrote it to ${written}, between the efforge:readme:graph markers.`))
      else if (input.format === "mermaid")
        lines.push(
          "",
          pc.dim(
            `Paste it into a \`\`\`mermaid block, or put it in README.md with ${BIN} graph --write.`,
          ),
        )
      yield* Console.log(lines.join("\n"))
    }).pipe(
      Effect.catch((e) =>
        Effect.gen(function* () {
          const args = yield* Invocation
          yield* report(input.json, graphFailure(e as never, args))
        }),
      ),
    ),
).pipe(
  Command.withDescription("Print the project's layer graph: what AppLayer merges, provides, needs"),
  Command.withExamples([
    { command: `${BIN} graph`, description: "The graph as Mermaid, for a README or an issue" },
    { command: `${BIN} graph --format=text`, description: "An indented list" },
    { command: `${BIN} graph --write`, description: "Put it in README.md and keep it current" },
  ]),
)
