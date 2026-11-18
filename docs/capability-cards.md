# Capability cards

A generated app's dashboard (`/app`) shows one card per capability the project has. A card has three parts: a working demo, the Effect code behind it, and where to go next (files, the test that swaps in a test layer, the `AGENTS.md` section). This page is how an add-on contributes its card. The realtime card (`templates/extras/realtime`) is the worked example throughout.

## What the generated app provides

These files come with every project (`templates/base/files/web/src`):

| File | What it is |
| --- | --- |
| `capabilities/types.ts` | `Capability`, the shape of a card |
| `capabilities/registry.ts` | `capabilities`, the list the dashboard renders; efforge appends to it |
| `capabilities/runtime.tsx` | The runtime card, the smallest complete example |
| `components/capability-card.tsx` | The card layout: demo, code, next steps. Cards never style themselves |
| `components/demo.tsx` | `FailureNote` (an error or "not configured" state) and `Pending` (loading) |
| `components/code-block.tsx`, `lib/highlight.ts` | Syntax-coloured code with file tabs, no dependency |
| `lib/snippet.ts` | `region(source, "card")`, the part of a file a card shows |
| `lib/use-server-call.ts` | `useServerCall(serverFn)`: idle, running, done or failed |
| `server/outcome.ts` | `runOutcome(effect)`: a server function's result, or its tagged error as data |
| `components/layer-graph.tsx`, `lib/layer-graph.ts` | The layer graph, read from `server/layers.ts` and annotated from the cards |

## Contribute a card

1. Write the card module, `files/card/<id>.tsx`, which exports one `Capability`.
2. Write the server functions only the card uses, if any, next to it.
3. Declare both under `card` in `addon.json`.
4. Ship a test layer and a test in `packages/core/test`, as a normal file.

### 1. The card module

```tsx
import { region } from "@/lib/snippet"
import program from "../../../../packages/core/src/realtime.ts?raw"
import serverFn from "../server/realtime-demo.ts?raw"
import type { Capability } from "./types"

function RealtimeDemo() {
  /* the demo; see "States" below */
}

export const realtime: Capability = {
  id: "realtime", // anchor (/app#realtime) and the landing page's link target
  title: "Realtime",
  summary: "WebSocket rooms on a hibernating Durable Object, behind the Realtime service; ...",
  layer: { name: "RealtimeLive", provides: ["Realtime"], needs: ["ROOM Durable Object"] },
  code: [
    { path: "packages/core/src/realtime.ts", source: region(program, "card") },
    { path: "apps/web/src/server/realtime-demo.ts", source: region(serverFn, "card") },
  ],
  files: [
    ["Service and program", "packages/core/src/realtime.ts"],
    ["Room (Durable Object)", "apps/web/src/realtime/Room.ts"],
  ],
  test: { path: "packages/core/test/realtime.test.ts", name: "refuses a message over the size limit with MessageTooLarge" },
  agents: "Realtime", // the AGENTS.md heading the add-on appends
  Demo: RealtimeDemo,
}
```

- `id` is the card's id on the landing page too: `lib/stack.ts` links a stack item to `/app#<id>` when the registry has that id. The ids it expects are `runtime`, `database`, `auth`, `ai`, and each extra's own id (`workflows`, `realtime`, `browser`, `storage`, `email`).
- `layer.name` is the expression's name in `layers.ts` (what `addLayer` added). The layer graph uses it to show `provides` and `needs`, and the card takes that layer's tempering colour. Leave `layer` out for a capability without a layer.
- `test.name` is the `it.effect` name of the test that swaps in a test layer.

### The snippet mechanism

Cards show real source, never a copy. Import the file with Vite's `?raw` (by a relative path, as the existing cards do) and pass it through `region(source, "card")`. Mark the part to show in the source file:

```ts
// #region card
export const announce = (roomId: string, text: string) =>
  Effect.gen(function* () { ... })
// #endregion
```

`region` drops the markers and the common indent; without markers it shows the whole file. Keep a region to 10-20 lines and its lines under about 85 characters, so the code panel does not scroll sideways at 1440 px: shorten doc comments inside regions rather than wrapping code. Show the part that teaches: the program with its tagged error, the server function, the layer. Two or three files per card, as tabs.

When the user edits the file, the card shows their edit (`?raw` modules are watched by `pnpm dev`).

### 2. Server functions

Run the Effect with `runOutcome` (from `./outcome`), not `runtime.runPromise`. Typed failures come back as `{ ok: false, error: { _tag, message } }`, and a layer that could not start for a missing setting (any error whose `_tag` ends in `ConfigError`) comes back as `NotConfigured`:

```ts
export const announce = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(AnnounceInput))
  .handler(({ data }) => runOutcome(announceProgram("demo", data.text)))
```

Every error in `E` needs `_tag` and `message`: `Data.TaggedError` with a `message` field. Put the logic in a program in `packages/core` (`announce`, `createNote`, `greet`) and keep the server function to validation and `runOutcome`, so the test can run the same program.

### 3. `addon.json`

```json
"card": {
  "export": "realtime",
  "files": [
    { "path": "files/card/realtime.tsx", "target": "apps/web/src/capabilities/realtime.tsx" },
    { "path": "files/card/realtime-demo.ts", "target": "apps/web/src/server/realtime-demo.ts" }
  ]
}
```

- `files[0]` is the card module and must target `apps/web/src/capabilities/`; `export` is its export. `loadAddons` refuses anything else.
- The other files are what only the card uses. Anything that imports the card-era base files (`outcome.ts`, `use-server-call.ts`, `components/demo.tsx`) belongs here, not in `files`.
- A file can carry `when`, like any add-on file. The card is registered when its module's `when` matches.
- No transform is needed. `generate` writes the files and appends the export to `capabilities` in `registry.ts` (with `addArrayItem`, after the add-on's own transforms), and `efforge add` does the same for an add-on added later.

A project made before cards (efforge 0.2.x) has no `registry.ts`. There, `add` writes everything except `card.files`, skips the registration, and prints one line: `No dashboard card for Realtime: this project has no apps/web/src/capabilities/registry.ts (it came with efforge 0.3). Everything else was added.` `AddResult.cardsSkipped` lists the titles. That is why the card's files are kept apart: they need base files an old project does not have.

### 4. The test layer and the test

Every card names one test that swaps in a test layer and covers a tagged error path. Ship it in `packages/core/test` as a normal add-on file. The realtime one gives `Realtime` an in-memory implementation and checks the program both ways:

```ts
const RealtimeInMemory = Layer.effect(
  Realtime,
  Effect.gen(function* () {
    const sent = yield* Sent
    return Realtime.of({
      connect: () => Effect.succeed(new Response(null, { status: 101 })),
      broadcast: (roomId, message) => Ref.update(sent, (all) => [...all, `${roomId}: ${message}`]),
      connections: () => Effect.succeed(2),
    })
  }),
).pipe(Layer.provideMerge(Layer.effect(Sent, Ref.make<ReadonlyArray<string>>([]))))

layer(RealtimeInMemory)("announce", (it) => {
  it.effect("refuses a message over the size limit with MessageTooLarge", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(announce("demo", "a".repeat(MAX_MESSAGE_BYTES + 1)))
      expect(error).toBeInstanceOf(MessageTooLarge)
    }),
  )
})
```

Use `it.effect` and `layer` from `@effect/vitest`; `Effect.run*` in a test is a lint error. A service with one fixed answer can be `Layer.succeed(Auth, Auth.of({ ... }))` (see `auth.test.ts`); time comes from `TestClock` (see `greeting.test.ts`).

## States a demo must handle

A demo talks to a real server, so it is honest about state. Use the helpers and the layout's spacing; do not restyle the card.

| State | How |
| --- | --- |
| Loading | `<Pending>Reading the note table…</Pending>`; disable the button that started it |
| Empty | A plain sentence that says what to do: "No notes yet. Add the first one." |
| Error | `<FailureNote error={state.error} />`: shows the `_tag` and the message |
| Not configured | The same `FailureNote`: for `NotConfigured` it says which setting is missing and where to set it (`.dev.vars`, or `.env` with Alchemy). Never a crash |
| Done | The result, and one line on what ran: "Answered at 7:55 PM by the Worker, through the `greet` program" |

`useServerCall(serverFn)` gives `{ state, run }` with `state.status` one of `idle`, `running`, `done`, `failed`. Load on mount with `useEffect(() => { void run() }, [run])` when the demo starts from data (the database card does).

Plain words, no marketing: "Send a test email", "This ran on the server through the `Mailer` service". Give inputs labels, keep every control reachable by keyboard, and never use colour alone for a state (the realtime status dot sits next to its word).

With `infra=alchemy` the page must not mention `wrangler.jsonc`: keep it out of card text, and out of the regions a card shows.

## Check it

- `pnpm test` in the repo: `test/dashboard.test.ts` checks that every database, ORM and auth combination registers the right cards from modules that export them, that `add` registers a card, and that a project without a registry gets the add-on without its card.
- Generate a stack with the add-on, run `pnpm typecheck && pnpm check && pnpm test && pnpm build`, then `pnpm dev`, open `/app` and use the demo in light and dark, at 1440 and 390 px wide.
