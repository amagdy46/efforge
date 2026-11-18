# Capability cards

A generated app's dashboard (`/app`) shows one card per capability the project has. A card has three parts: a working demo, the Effect code behind it, and where to go next (files, the test that swaps in a test layer, the `AGENTS.md` section). This page is how an add-on contributes its card. The realtime card (`templates/extras/realtime`) is the worked example throughout. [ADR 0008](decisions/0008-capability-cards.md) records why it works this way.

## The rules, in short

- A card's server functions live in its own files under `apps/web/src/server/`. On auth stacks efforge adds `requireSession` to every one of them, reads included; you never write that guard, and auth added after your card guards it too.
- A card's files, its transforms, that guard and its registration are one unit. `add` applies all of it, or none of it in a project without the card registry. You never have to think about which.
- A card shows only the `// #region card` block of a file. That block is public: it ships to the browser. The rest of the file does not.
- Region lines are at most 80 characters.
- Every failure your card can produce has a tagged error with a `message`, and the demo shows it as a state.

## What the generated app provides

These files come with every project (`templates/base/files/web`):

| File | What it is |
| --- | --- |
| `src/capabilities/types.ts` | `Capability`, the shape of a card |
| `src/capabilities/registry.ts` | `capabilities`, the list the dashboard renders; efforge appends to it |
| `src/capabilities/runtime.tsx` | The runtime card, the smallest complete example |
| `src/components/capability-card.tsx` | The card layout: demo, code, next steps. Cards never style themselves |
| `src/components/demo.tsx` | `FailureNote` (an error or "not configured" state) and `Pending` (loading) |
| `src/components/code-block.tsx`, `src/lib/highlight.ts` | Syntax-coloured code with file tabs, no dependency |
| `regions.ts` | The Vite plugin behind `?region=card`: the marked part of a file, cut at build time |
| `src/lib/use-server-call.ts` | `useServerCall(serverFn)`: idle, running, done or failed |
| `src/lib/failure.ts` | `asFailure(error)`: a rejected call as a `Failure` with its tag |
| `src/server/outcome.ts` | `runOutcome(effect)`: a server function's result, or its tagged error as data |
| `src/server/settings.ts` | `NotConfigured`: a missing setting, named, with the file to put it in |
| `src/start.ts` | Keeps a tagged error's `_tag` on its way to the browser |
| `src/components/layer-graph.tsx`, `src/lib/layer-graph.ts` | The layer graph, read from `server/layers.ts` and annotated from the cards |

## Contribute a card

1. Write the card module, `files/card/<id>.tsx`, which exports one `Capability`.
2. Write the server functions only the card uses, if any, in their own files.
3. Declare both under `card` in `addon.json`.
4. Ship a test layer and a test in `packages/core/test`, as a normal file.
5. Add a row for a new slot option in `lib/stack.ts` (base), so the landing page labels it and links its card.

### 1. The card module

```tsx
import program from "../../../../packages/core/src/realtime.ts?region=card"
import serverFn from "../server/realtime-demo.ts?region=card"
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
    { path: "packages/core/src/realtime.ts", source: program },
    { path: "apps/web/src/server/realtime-demo.ts", source: serverFn },
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

Every field is required except `layer`:

- `id` is the card's id on the landing page too: `lib/stack.ts` links a stack item to `/app#<id>` when the registry has that id. The ids it expects are `runtime`, `database`, `auth`, `ai`, and each extra's own id (`workflows`, `realtime`, `browser`, `storage`, `email`).
- `layer.name` is the expression's name in `layers.ts` (what `addLayer` added). The layer graph uses it to show `provides` and `needs`, and the card takes that layer's tempering colour. Leave `layer` out for a capability without a layer.
- `test.name` is the `it.effect` name of a test the card's code is about, one that swaps in a test layer. Every card has one: the add-on ships it (step 4).
- `agents` is a `##` heading the add-on appends to `AGENTS.md` with `appendAgentsSection`, exactly as written there. Every card's add-on appends one.

### The code a card shows

Cards show real source, never a copy. Import the file with `?region=card` (by a relative path, as the existing cards do) and mark the part to show in the source file:

```ts
// #region card
export const announce = (roomId: string, text: string) =>
  Effect.gen(function* () { ... })
// #endregion
```

- Only the region reaches the browser: `regions.ts` cuts it out at build time, so the rest of the file stays on the server. The region itself is public on every stack, auth or not, because static assets are not behind the session. Never mark a part that holds a secret, a key or anything private.
- A file without the region fails the build with a message that names it. There is no "whole file" fallback.
- Keep a region to 10-20 lines and every line to 80 characters, so the code panel does not scroll sideways at 1440 px. On auth stacks efforge inserts `.middleware([requireSession])` into a card's server functions, and a repo test checks the 80 characters on every stack. Shorten doc comments rather than wrapping code, and write an object or a type literal over several lines when it would be long: the formatter keeps it that way.
- Show the part that teaches: the program with its tagged error, the server function, the layer. Two or three files per card, as tabs.

When the user edits the file, the card shows their edit (`pnpm dev` watches it).

### 2. Server functions

Put each server function the card calls in a card file under `apps/web/src/server/` (step 3), and only there: `loadAddons` refuses a card file elsewhere that calls `createServerFn`, and a card file there that does not. Run the Effect with `runOutcome` (from `./outcome`), not `runtime.runPromise`:

```ts
const AnnounceInput = Schema.Struct({ text: Schema.String })

export const announce = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(AnnounceInput))
  .handler(({ data }) => runOutcome(announceProgram("demo", data.text)))
```

- Do not add `requireSession`. On auth stacks efforge chains `.middleware([requireSession])` on every `createServerFn` in the card's server files, GET and POST alike, so an anonymous request gets `Unauthorized` and never reaches the handler. It does this when the card is written and again when auth is added later.
- Typed failures come back as `{ ok: false, error: { _tag, message } }`. They are logged on the server; only `_tag` and `message` reach the browser, so put a driver's raw text in another field, never in `message`.
- Every error in `E` needs `_tag` and `message`: `Data.TaggedError` with a `message` field that is always set. TypeScript does not catch a missing one, because `Error` has `message`.
- Put the logic in a program in `packages/core` (`announce`, `createNote`, `greet`) and keep the server function to validation and `runOutcome`, so the test can run the same program.
- The demo calls it as `run({ data: { text } })`; a GET without input as `run()`.
- Keep the validator's limits and the input's `maxLength` the same, and the program's own limits inside them, so the program's tagged error is what a user sees. A validator rejection still arrives as `InvalidInput` with its messages.

### Settings

A layer that reads a setting fails to start when it is missing, and the runtime turns that into `NotConfigured`, which names the setting and the file (`.dev.vars`, or `.env` with Alchemy). `AppLayer` is built as a whole, so one missing setting stops every card and every route that needs the runtime: routes show a "Not configured yet" page, and cards whose call returns `NotConfigured` show it as their state. Read settings in your layer with `Config` (as `auth-live.ts` does with `BETTER_AUTH_SECRET`), and list them in `envVars` with a `description` that says where the value comes from. A layer that checks a setting itself (a secret that is too short, a sender a transport needs) fails with its own `...ConfigError` that carries the name in a `setting` field, as `StorageConfigError` and `MailerConfigError` do; the runtime turns that into `NotConfigured` for that setting too.

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

- `files[0]` is the card module and must target `apps/web/src/capabilities/`; `export` is its export.
- The other files are what only the card uses. Anything that imports the card-era base files (`outcome.ts`, `use-server-call.ts`, `components/demo.tsx`) belongs here, not in `files`. Server functions go in files under `apps/web/src/server/`.
- A file can carry `when`, like any add-on file. The card is registered when its module's `when` matches.
- `transforms` (optional) are transforms that edit only the card's own files, for example an `addImport` that depends on the stack. `loadAddons` refuses one that edits any other file: put that under the add-on's `transforms`.
- You never write the guard or the registration. After the add-on's own transforms, efforge runs the card's `transforms`, then `addServerFnMiddleware` with `requireSession` on each server file (`when` auth), then `addArrayItem` on `capabilities` in `registry.ts`.

The card is one unit. A project made before cards (efforge 0.2.x), or one whose dashboard was removed, has no `registry.ts`. There, `add` writes everything except the card's files, runs none of the card's transforms, and puts one line in `notes` (printed as a warning, and in `add --json`): `No dashboard card for Realtime: this project has no apps/web/src/capabilities/registry.ts (made before efforge 0.3, or its dashboard was removed). The add-on works without it; there is nothing to do.` A card transform also skips a card file the project no longer has. That is why the card's files are kept apart: they need base files an old project does not have, and the guard needs the file it edits.

An add-on that needs a base file an old project lacks can list it in its own `files` with `"ifAbsent": true`: it is written only where the project has no such file, and never replaces one. Do not list a file the user is expected to edit (the shell, the project name) any other way.

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

Put a test layer that users will want for their own tests in its own exported file next to the test (`packages/core/test/storage-in-memory.ts` exports `StorageInMemory`, `mailer-in-memory.ts` exports `MailerInMemory` and the `SentMail` it records into), and name it in the add-on's `AGENTS.md` section. Use `it.effect` and `layer` from `@effect/vitest`; `Effect.run*` in a test is a lint error. A service with one fixed answer can be `Layer.succeed(Auth, Auth.of({ ... }))` (see `auth.test.ts`); time comes from `TestClock` (see `greeting.test.ts`). Test the program, not the fake: a test that only checks the test layer returns what it was given proves nothing.

## States a demo must handle

A demo talks to a real server, so it is honest about state. Use the helpers and the layout's spacing; do not restyle the card.

| State | How |
| --- | --- |
| Loading | `<Pending>Reading the note table…</Pending>`; disable the button that started it |
| Empty | A plain sentence that says what to do: "No notes yet. Add the first one." |
| Error | `<FailureNote error={state.error} />`: shows the `_tag` and the message |
| Not configured | The same `FailureNote`: for `NotConfigured` it says which setting is missing and where to set it. Never a crash |
| Done | The result, and one line on what ran: "Answered at 7:55 PM by the Worker, through the `greet` program" |

`useServerCall(serverFn)` gives `{ state, run }` with `state.status` one of `idle`, `running`, `done`, `failed`; `run` resolves to the outcome. Load on mount with `useEffect(() => { void run() }, [run])` when the demo starts from data (the database card does). A call the server rejects fails with its own tag (`Unauthorized`, `NotConfigured`), `InvalidInput` (the validator), `Unreachable` (no answer) or `Defect` (a bug), never a blank message.

- Keep what the user typed when a call fails, so they can fix it and send again: clear the input only when the outcome is `ok`.
- Make every error path you show in the code reachable from the demo (the realtime card's "Send from the server" sends the typed text, so an oversized one comes back as `MessageTooLarge`).
- A server function that writes or spends is open to anyone on a stack without auth. Say so on the card: `getStack()` from `@/server/stack` returns the stack, and the storage and email cards add one sentence when `stack.auth` is `"none"`. Add a `when: { auth: ["none"] }` `AGENTS.md` subsection that says the same, worded so it stays true once auth is added (`appendAgentsSection` never rewrites a section).
- Plain words, no marketing: "Send a test email", "This ran on the server through the `Mailer` service". Give inputs labels, keep every control reachable by keyboard, and never use colour alone for a state (the realtime status dot sits next to its word).

With `infra=alchemy` the page must not mention `wrangler.jsonc`: keep it out of card text, and out of the regions a card shows.

## Check it

- `pnpm test` in the repo. `test/cards.test.ts` generates every card's add-on with every auth option and fails if any `createServerFn` in a card's server files lacks `requireSession`, so a new card is checked without a change there; it also covers auth added after a card, a project from before cards, and `loadAddons` refusing a card that breaks the rules above. `test/generated-code.test.ts` checks that every region a registered card shows exists and fits 80 characters on every stack. `test/dashboard.test.ts` checks the registry for every database, ORM and auth combination. `test/fmt-clean.test.ts` checks that templates and generated stacks are already formatted, the guard included.
- `pnpm test:e2e` builds each stack and fails if a comment from outside a card's region is in the client bundle.
- Generate a stack with the add-on, run `pnpm typecheck && pnpm check && pnpm test && pnpm build`, then `pnpm dev`, open `/app` and use the demo in light and dark, at 1440 and 390 px wide, signed in and (on an auth stack) with the server function called without a session.
