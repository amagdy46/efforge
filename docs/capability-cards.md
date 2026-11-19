# Capability cards

A generated app's dashboard (`/app`) shows one card per capability the project has. A card has three parts: a working demo, the Effect code behind it, and where to go next (files, the test that swaps in a test layer, the `AGENTS.md` section). This page is how an add-on contributes its card. The realtime card (`templates/extras/realtime`) is the worked example throughout. [ADR 0008](decisions/0008-capability-cards.md) records why it works this way.

## The rules, in short

- On auth stacks every server function in `apps/web` requires a session, reads included, wherever its file is listed (`card.files` or the add-on's `files`). At runtime `sessionGate`, global function middleware in `apps/web/src/start.ts`, refuses every server function without a session unless it is in `apps/web/src/server/public-server-fns.json` (`getSession`, `getAppState`, `getStack`), so code the user or their agent writes later is held to it too. efforge also adds `requireSession` to every server function an add-on writes, which gives the handler `context.session`; you never write that guard, and auth added after your card guards it too. The project's lint rule `efforge/server-fn-session` fails `pnpm check` on a server function without it, as early feedback.
- A card channel that is not a server function (a WebSocket, a download route) checks the session itself on auth stacks, the same way: the realtime room's upgrade runs `requireSocketSession`, which closes a socket without a session with 4401 "Not signed in", and the card shows that state. Without auth the channel is open, and the card says so.
- A card's server functions live in its own files under `apps/web/src/server/` (subdirectories work).
- A card's files, its transforms, that guard and its registration are one unit. `add` applies all of it, or none of it in a project without the card registry. You never have to think about which.
- A card shows only the `// #region card` block of a file. That block is public: it ships to the browser. The rest of the file does not. `?region=` is the only way to import a file as text: lint rejects `?raw`, `?url` and the other whole-file queries (`efforge/no-whole-file-import`), and `pnpm build` fails when a file under `src/server/`, `.dev.vars` or `.env*`, or a secret's value from them, would reach the browser.
- Every setting a layer reads, when missing or unusable, produces `NotConfigured` naming that setting. Read it with `Config`, or fail with your own `...ConfigError` that has a `setting` field.
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
| `src/lib/use-server-call.ts` | `useServerCall(serverFn, ...errors)`: idle, running, done or failed, the failure decoded into its class; `settleCall` for one call outside a hook |
| `src/lib/outcome.ts` | `Outcome` (the encoded `Exit` a server function returns), `decodeOutcome`, `NotConfigured`, `Failure` |
| `src/lib/failure.ts` | `asFailure(error)`: a rejected call as a `Failure` with its tag |
| `src/server/outcome.ts` | `runOutcome(effect, ...errors)`: runs the Effect as a span named after the function and returns its `Exit`, encoded |
| `src/server/name-call.ts` | `nameCall`: names that span after the server function (`serverFn.announce`) |
| `packages/core/src/server-only.ts` | `ServerOnly`: an error field that stays on the server (a driver's `cause`) |
| `src/server/settings.ts` | `NotConfigured`: a missing setting, named, with the file to put it in |
| `src/start.ts` | Runs `nameCall` (and `sessionGate` with auth) before every server function; keeps a thrown tagged error's `_tag` on its way to the browser |
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
- In a `.ts` or `.tsx` file the markers are read as code: only a real `//` comment counts, so a `// #region card` line inside a template string or a string is part of that string.
- Keep a region to 10-20 lines and every line to 80 characters, so the code panel does not scroll sideways at 1440 px. On auth stacks efforge inserts `.middleware([requireSession])` into a card's server functions, and a repo test checks the 80 characters on every stack. Shorten doc comments rather than wrapping code, and write an object or a type literal over several lines when it would be long: the formatter keeps it that way.
- Show the part that teaches: the program with its tagged error, the server function, the layer. Two or three files per card, as tabs.

When the user edits the file, the card shows their edit (`pnpm dev` watches it).

### 2. Server functions

Put each server function the card calls in a card file under `apps/web/src/server/` (step 3), and only there: `loadAddons` refuses a card file elsewhere that calls `createServerFn`, and a card file there that does not. Run the Effect with `runOutcome` (from `./outcome`), not `runtime.runPromise`, and list the tagged errors it can fail with. Declare the list once, exported beside the server function as `<Name>Errors`, and spread it:

```ts
const AnnounceInput = Schema.Struct({ text: Schema.String })

export const AnnounceErrors = [MessageTooLarge, RealtimeError] as const

export const announce = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(AnnounceInput))
  .handler(({ data }) => {
    const program = announceProgram("demo", data.text)
    return runOutcome(program, ...AnnounceErrors)
  })
```

The demo imports the same list, and gets each failure back as an instance of its class, with its fields:

```tsx
const server = useServerCall(announce, ...AnnounceErrors)
// server.state.error instanceof MessageTooLarge, server.state.error.limit
```

The types hold the two sides to one list: `runOutcome` records the tags of the errors it lists in the `Outcome` it returns, and `useServerCall` and `settleCall` accept only error classes with those tags, in that order. A client that lists one too few, none, or another error does not typecheck, so the lists cannot drift. A server function with no errors to list takes none on either side. The error classes come from `packages/core`, which the browser loads anyway; importing the list from the server file adds nothing else to the browser, since the compiler strips the handler and what only it uses.

- Do not add `requireSession`. On auth stacks efforge chains `.middleware([requireSession])` on every `createServerFn` in the add-on's files under `apps/web/src/`, GET and POST alike, so an anonymous request gets `Unauthorized` and never reaches the handler. It does this when the file is written and again when auth is added later. A function that already has `.middleware([timing])` gets `[requireSession, timing]`; one whose `.middleware(...)` is not a written-out list cannot be edited, so `add` names it in a note with the fix and the project's `pnpm check` fails until it is guarded.
- A server function that must answer signed-out visitors is rare (the route guard's `getSession`, the landing page's `getStack`). It needs its name on the `public` list of `efforge/server-fn-session` in the base `vite.config.ts` and in `PUBLIC_SERVER_FNS` (`src/cards.ts`); a test checks the two agree. Ask before adding one.
- `runOutcome` returns the Effect's `Exit`, encoded with `Schema` (`toCodecJson`), and logs typed failures on the server. Every field of a listed error reaches the browser, so declare a driver's raw error as `cause: ServerOnly`, which encoding drops, and never put it in `message` or another field. An error you do not list arrives as its `_tag` and `message` only; `NotConfigured` always arrives as itself. A defect still rejects, a 500.
- Every error in `E` needs `_tag` and `message`. Declare it with `Schema.TaggedError` and a brand (`Schema.TaggedError<MessageTooLarge, { readonly brand: unique symbol }>()("MessageTooLarge", { message: Schema.String, limit: Schema.Number })`; the project's lint asks for the brand), with a `message` that is always set. TypeScript does not catch a missing one, because `Error` has `message`. Give it the fields a UI would use (`limit`, `url`, `address`); the card shows them.
- Put the logic in a program in `packages/core` (`announce`, `createNote`, `greet`) and keep the server function to validation and `runOutcome`, so the test can run the same program.
- The demo calls it as `run({ data: { text } })`; a GET without input as `run()`.
- Keep the validator's limits and the input's `maxLength` the same, and the program's own limits inside them, so the program's tagged error is what a user sees. A validator rejection still arrives as `InvalidInput` with its messages.
- A result that arrives over time can still be one call. A `ReadableStream` inside the value streams to the browser (the AI card returns its answer as `ReadableStream<{ text } | { failure }>`, so a failure part way through is a part, not a broken stream). A run that goes on after the call returns is followed with a second server function the demo calls again until it is done, each call waiting on the server for news (the workflows card reads `WorkflowInstance.subscribe` from the last event it saw). Either way, every wait has an end: a demo that can spin forever is a bug.
- A card's server file may read the project's stack (`import { stack } from "./manifest"`) to word a state for it, for example the browser card's "turn containers on" step, which names `wrangler.jsonc` only when the project has it. Keep such text outside the region.

### Settings

A layer that reads a setting fails to start when it is missing, and the runtime turns that into `NotConfigured`, which names the setting and the file (`.dev.vars`, or `.env` with Alchemy). `AppLayer` is built as a whole, so one missing setting stops every card and every route that needs the runtime: routes show a "Not configured yet" page, and cards whose call returns `NotConfigured` show it as their state. Read settings in your layer with `Config` (as `auth-live.ts` does with `BETTER_AUTH_SECRET`), and list them in `envVars` with a `description` that says where the value comes from. A setting that is set but unusable (too short, not a URL), or one a layer checks itself (a sender a transport needs), fails with the layer's own `...ConfigError` carrying `setting` and a `message` that says what is wrong (`StorageConfigError`, `MailerConfigError`, `AuthConfigError`): the page then reads "This page needs `STORAGE_SIGNING_SECRET`. STORAGE_SIGNING_SECRET is too short: …". `test/generated-code.test.ts` checks that every env var an add-on declares and a layer reads produces a page that names it.

A layer is built once per Worker isolate, inside whichever request comes first. Keep its construction synchronous: never await a promise there that another request might wait on or that outlives the request (see the auth section of the generated `AGENTS.md`); hand slow start-up work to `waitUntil` from `cloudflare:workers`, as `auth-live.ts` does.

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

The card is one unit. A project made before cards (efforge 0.2.x), or one whose dashboard was removed, has no `registry.ts`. There, `add` writes everything except the card's files, runs none of the card's transforms, and puts one line in `notes` (printed as a warning, and in `add --json`): `No dashboard card for Realtime: this project has no apps/web/src/capabilities/registry.ts (made before efforge 0.3, or its dashboard was removed). Each add-on's service, layer and tests are written; its card and the card's server functions (apps/web/src/server/realtime-demo.ts) are not. Nothing else is needed: call the service from your own server functions.` A card transform also skips a card file the project no longer has. An add-on transform that hardens a file an older project has in an older shape (the session check on the realtime route) carries `ifMissing`, a note: when its anchor is not there, `add` goes on, leaves the file as it is and prints that note, which says what to add by hand. That is why the card's files are kept apart: they need base files an old project does not have, and the guard needs the file it edits.

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

Put a test layer that users will want for their own tests in its own exported file next to the test (`packages/core/test/storage-in-memory.ts` exports `StorageInMemory`, `mailer-in-memory.ts` exports `MailerInMemory` and the `SentMail` it records into, `jobs-in-memory.ts` exports `JobsInMemory`, `llm-fixed.ts` exports `LlmFixed`, `browser-in-memory.ts` exports `BrowserInMemory`), and name it in the add-on's `AGENTS.md` section. A file without `.test.` in its name is not run as a test.

Use `it.effect` and `layer` from `@effect/vitest`; `Effect.run*` in a test is a lint error. A service with one fixed answer can be `Layer.succeed(Auth, Auth.of({ ... }))` (see `auth.test.ts`); time comes from `TestClock` (see `greeting.test.ts`). Test the program, not the fake: a test that only checks the test layer returns what it was given proves nothing.

## States a demo must handle

A demo talks to a real server, so it is honest about state. Use the helpers and the layout's spacing; do not restyle the card.

| State | How |
| --- | --- |
| Loading | `<Pending>Reading the note table…</Pending>`; disable the button that started it |
| Empty | A plain sentence that says what to do: "No notes yet. Add the first one." |
| Error | `<FailureNote {...state} />`: shows the `_tag`, the message and the error's fields, and says when the server rejected the call |
| Not configured | The same `FailureNote`: for `NotConfigured` it says which setting is missing and where to set it. Never a crash. A setup step your add-on reports with its own tag (`LlmNotConfigured`: no key saved; `BrowserUnavailable`: no container in local dev) is shown the same way: pass `{ _tag: "NotConfigured", message }` when `state.error instanceof LlmNotConfigured` |
| Done | The result, and one line on what ran: "Answered at 7:55 PM by the Worker, through the `greet` program" |

`useServerCall(serverFn, ...errors)` gives `{ state, run }` with `state.status` one of `idle`, `running`, `done`, `failed`; `run` resolves to `{ ok: true, value }` or `{ ok: false, error, rejected }`. Load on mount with `useEffect(() => { void run() }, [run])` when the demo starts from data (the database card does). A failed state's `error` is the tagged error the Effect failed with, as its class (`rejected: false`), or, for a call the server refused, `rejected: true` with its own tag (`Unauthorized` from the session gate), `InvalidInput` (the validator), `Unreachable` (no answer) or `Defect` (a bug, a 500), never a blank message. A demo that calls a server function itself (the AI card reads a stream; the workflows card polls) uses `settleCall(serverFn(input), ...errors)` for the same result.

- Keep what the user typed when a call fails, so they can fix it and send again: clear the input only when the result is `ok`.
- Make every error path you show in the code reachable from the demo (the realtime card's "Send from the server" sends the typed text, so an oversized one comes back as `MessageTooLarge`).
- Say who may use the demo with `access` on the card. `{ effect: "reads" }` for one that changes nothing. A demo with a server function that writes (stores something) or spends (a model call, an email, a container) is `{ effect: "writes" | "spends", open, signedIn }`: the card frame shows `open` after "Open endpoint." while `efforge.jsonc` says `auth: "none"`, and `signedIn` after "Any signed-in user." with auth, since sign-up is open. A test over the registry fails on a card with a `POST` server function that says `reads`. A card that needs the stack for other wording (the email card names `.env` on Alchemy) calls `useStack()` from `@/lib/use-stack`, which asks `getStack` once per page for every card. Do not call `getStack` from a card yourself. Add a `when: { auth: ["none"] }` `AGENTS.md` subsection that says the same as `open`; `add` drops it when auth is added, since the sections are regenerated from the stack.
- Data a user makes belongs to them: key it by `currentOwner` from `apps/web/src/server/owner.ts` (the signed-in user's id with auth, one shared owner without), as the storage and workflows cards do. Say on the card when data is shared on purpose, as the database card does.
- Plain words, no marketing: "Send a test email", "This ran on the server through the `Mailer` service". Give inputs labels, keep every control reachable by keyboard, and never use colour alone for a state (the realtime status dot sits next to its word).

With `infra=alchemy` the page must not mention `wrangler.jsonc`: keep it out of card text, and out of the regions a card shows.

## Check it

- `pnpm test` in the repo. `test/server-fn-session.test.ts` runs the generated project's own lint rules with the real oxlint over every add-on on every auth option (and over a throwaway add-on that lists its server function under `files`, and one whose middleware efforge cannot edit), so a server function that would answer without a session fails there. `test/cards.test.ts` generates every card's add-on with every auth option and fails if any `createServerFn` in a card's server files lacks `requireSession`, so a new card is checked without a change there; it also covers auth added after a card, a project from before cards, and `loadAddons` refusing a card that breaks the rules above. `test/generated-code.test.ts` checks that every region a registered card shows exists and fits 80 characters on every stack. `test/dashboard.test.ts` checks the registry for every database, ORM and auth combination. `test/fmt-clean.test.ts` checks that templates and generated stacks are already formatted, the guard included.
- `pnpm test:e2e` builds each stack and fails if a comment from outside a card's region is in the client bundle.
- Generate a stack with the add-on, run `pnpm typecheck && pnpm check && pnpm test && pnpm build`, then `pnpm dev`, open `/app` and use the demo in light and dark, at 1440 and 390 px wide, signed in and (on an auth stack) with the server function called without a session.
