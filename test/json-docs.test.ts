import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { stripVTControlCharacters } from "node:util"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { afterEach, expect, it, vi } from "vitest"
import { runWith } from "../src/cli.ts"
import { errorCodes } from "../src/contract.ts"
import { TemplatesDir } from "../src/commands/create.ts"
import { livePromptIO, PromptIO } from "../src/prompts/navigable.ts"
import { recordingSpawner } from "./recordingSpawner.ts"

// Every example in docs/json.md is the output of the command printed above it, run here against
// the scenario its id names. EFFORGE_UPDATE_DOCS=1 rewrites the outputs instead of comparing.

const root = new URL("..", import.meta.url).pathname
const docPath = join(root, "docs/json.md")
/** Where examples pretend to run; temp paths are rewritten to it. */
const SHOWN = "/home/me/projects"

// prompts would fail fast (no terminal in tests), and the chrome is not part of any example
const quietIO = Layer.succeed(PromptIO, {
  ...livePromptIO,
  intro: () => Effect.void,
  section: () => Effect.void,
  info: () => Effect.void,
  warn: () => Effect.void,
  note: () => Effect.void,
  outro: () => Effect.void,
  step: (_l, eff) => eff,
  task: (_l, eff) => eff(() => {}),
})

interface Scenario {
  /** Prepares `work` (the directory the command runs in, unless `cwd` says otherwise). */
  readonly setup?: (work: string) => Promise<void>
  readonly cwd?: string
  /** Commands that fail, with their output. */
  readonly fail?: (command: string) => string | undefined
  readonly templates?: string
}

const cli = async (
  args: ReadonlyArray<string>,
  cwd: string,
  s: Scenario = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  const stdout: string[] = []
  const stderr: string[] = []
  const log = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    stdout.push(a.join(" "))
  })
  const error = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    stderr.push(a.join(" "))
  })
  const before = process.cwd()
  process.chdir(cwd)
  process.exitCode = undefined
  try {
    await runWith(args).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          quietIO,
          recordingSpawner([], undefined, s.fail),
          ...(s.templates === undefined ? [] : [Layer.succeed(TemplatesDir, s.templates)]),
        ),
      ),
      Effect.runPromise,
    )
  } finally {
    process.chdir(before)
    log.mockRestore()
    error.mockRestore()
  }
  const exitCode = process.exitCode ?? 0
  process.exitCode = undefined
  return { stdout: stdout.join("\n"), stderr: stderr.join("\n"), exitCode }
}

const project =
  (name: string, ...flags: string[]) =>
  async (work: string) => {
    const r = await cli(["create", name, "--json", "--no-git", ...flags], work)
    expect(r.exitCode, r.stdout).toBe(0)
  }
const myApp = project("my-app", "--database=d1", "--auth=better-auth")

const scenarios: Record<string, Scenario> = {
  create: {},
  "create-dry-run": {},
  list: {},
  "list-project": { setup: myApp },
  add: { setup: myApp },
  "add-dry-run": { setup: myApp },
  UnknownFlag: {},
  InvalidFlagValue: {},
  UnexpectedArgument: {},
  UnknownCommand: {},
  NeedsInput: {},
  UnknownValue: {},
  IncompatibleStack: {},
  InvalidProjectName: {},
  TargetNotEmpty: { setup: myApp },
  PnpmMissing: { fail: (c) => (c === "pnpm --version" ? "pnpm: not found" : undefined) },
  SetupIncomplete: {
    fail: (c) =>
      c.startsWith("pnpm install")
        ? "ERR_PNPM_META_FETCH_FAIL  GET https://registry.npmjs.org/effect: request to registry.npmjs.org failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org"
        : undefined,
  },
  WriteFailed: {
    setup: async (work) => {
      mkdirSync(join(work, "readonly"))
      chmodSync(join(work, "readonly"), 0o555)
    },
    cwd: "readonly",
  },
  NotAnEfforgeProject: { setup: myApp, cwd: "my-app/apps/web" },
  NoAddonIds: { setup: myApp },
  UnknownAddon: { setup: myApp },
  SlotAlreadySet: { setup: myApp },
  RemoveNotSupported: { setup: myApp },
  OverlayConflict: {
    setup: async (work) => {
      await project("my-app", "--database=d1", "--orm=effect-sql", "--auth=none")(work)
      const dashboard = join(work, "my-app/apps/web/src/routes/app/index.tsx")
      writeFileSync(
        dashboard,
        readFileSync(dashboard, "utf8").replace("Notes", "My notes").replace("Notes", "My notes"),
      )
    },
  },
  TransformAnchorMissing: {
    setup: async (work) => {
      await myApp(work)
      writeFileSync(
        join(work, "my-app/apps/web/src/server/layers.ts"),
        'import { Layer } from "effect"\n\nexport const AppLayer = Layer.empty\n',
      )
    },
  },
  CommandFailed: {
    setup: async (work) => {
      await myApp(work)
      mkdirSync(join(work, "my-app/node_modules"))
    },
    fail: (c) =>
      c.startsWith("pnpm install")
        ? "ERR_PNPM_META_FETCH_FAIL  GET https://registry.npmjs.org/@effect%2Fai-openai: request to registry.npmjs.org failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org"
        : undefined,
  },
  InternalError: { templates: "/nonexistent/templates" },
}

/** Splits a documented command the way a shell would (single quotes only). */
const shellSplit = (line: string): string[] =>
  [...line.matchAll(/'([^']*)'|(\S+)/g)].map((m) => m[1] ?? (m[2] as string))

/** Paths and lists made readable and stable: temp dirs, long arrays, the version. */
const normalize = (text: string, work: string): string => {
  const shown = text.replaceAll(work, SHOWN)
  if (!shown.trimStart().startsWith("{")) return stripVTControlCharacters(shown).trimEnd()
  const elide = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v)) {
      const items = v.map((x) => elide(x))
      return (key === "files" || key === "addons") && items.length > 4
        ? [...items.slice(0, 3), `... ${items.length - 3} more`]
        : items
    }
    if (v !== null && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, elide(x, k)]))
    return v
  }
  return JSON.stringify(elide(JSON.parse(shown)), null, 2)
}
/** The CLI version changes every release; examples are compared without it. */
const unversioned = (s: string) => s.replace(/"efforge": "[^"]*"/g, `"efforge": "<version>"`)

const example = /<!-- example: (\S+) -->\n+```sh\n(.+)\n```\n+```(json|text)\n([\s\S]*?)\n```/g

afterEach(() => vi.restoreAllMocks())

it("every example in docs/json.md is what the command prints", { timeout: 120_000 }, async () => {
  const doc = readFileSync(docPath, "utf8")
  const found = [...doc.matchAll(example)]
  const byName = (a = "", b = "") => a.localeCompare(b)
  expect(found.map((m) => m[1]).toSorted(byName)).toEqual(Object.keys(scenarios).toSorted(byName))
  let updated = doc
  for (const [block, id, command, , shownOutput] of found) {
    const s = scenarios[id as string] as Scenario
    const work = mkdtempSync(join(tmpdir(), "efforge-doc-"))
    try {
      await s.setup?.(work)
      const tokens = shellSplit(command as string)
      expect(tokens.slice(0, 2), id).toEqual(["npx", "create-efforge"])
      const r = await cli(tokens.slice(2), join(work, s.cwd ?? "."), s)
      const raw = r.stdout !== "" ? r.stdout : r.stderr
      const out = normalize(raw, work)
      if (process.env.EFFORGE_UPDATE_DOCS === "1")
        updated = updated.replace(block, block.replace(shownOutput as string, out))
      else expect(unversioned(out), id).toBe(unversioned(shownOutput as string))
      // error examples are errors, success examples aren't
      expect(r.exitCode, `${id}: ${raw}`).toBe((id as string) in errorCodes ? 1 : 0)
    } finally {
      chmodSync(work, 0o755)
      for (const d of ["readonly"]) {
        try {
          chmodSync(join(work, d), 0o755)
        } catch {}
      }
      rmSync(work, { recursive: true, force: true })
    }
  }
  if (updated !== doc) writeFileSync(docPath, updated)
})

it("docs/json.md documents every error code", () => {
  const doc = readFileSync(docPath, "utf8")
  for (const code of Object.keys(errorCodes)) {
    expect(doc, code).toContain(`### \`${code}\``)
    expect(doc, code).toContain(`<!-- example: ${code} -->`)
  }
})
