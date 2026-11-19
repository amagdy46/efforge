import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join, posix } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { afterAll, expect, it } from "@effect/vitest"
import { Cause, Config, ConfigProvider, Effect, Exit, Layer } from "effect"
import { loadAddons } from "../src/addon.ts"
import { generate } from "../src/generate.ts"
import { withDefaults } from "../src/stack.ts"

// Modules of the generated app, run here. They are copied out of templates/ first (the templates'
// tsconfig files extend paths that only exist in a generated project), into a directory that
// resolves `effect` from this repo's node_modules.

const templates = new URL("../templates/", import.meta.url).pathname
const cache = new URL("../node_modules/.cache/", import.meta.url).pathname
mkdirSync(cache, { recursive: true })
const dir = mkdtempSync(join(cache, "efforge-code-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
/** `path` copied to `<its folder's name>/<its name>`, so `../lib/outcome` resolves, then loaded. */
const load = async <M>(path: string): Promise<M> => {
  const copy = join(dir, basename(dirname(path)), basename(path))
  mkdirSync(dirname(copy), { recursive: true })
  copyFileSync(join(templates, path), copy)
  // the generated project's vite; efforge itself has it as vite-plus
  const text = readFileSync(copy, "utf8")
  if (text.includes('from "vite"'))
    writeFileSync(copy, text.replace('from "vite"', 'from "vite-plus"'))
  return (await import(copy)) as M
}
// what server/manifest.ts reads from efforge.jsonc, and the module settings.ts takes NotConfigured from
mkdirSync(join(dir, "server"), { recursive: true })
writeFileSync(join(dir, "server/manifest.ts"), 'export const stack = { infra: "none" }\n')
await load("base/files/web/src/lib/outcome.ts")

const { authBaseURL } = await load<{
  authBaseURL: (url: string | undefined, dev: boolean) => unknown
}>("auth/better-auth/files/shared/server/auth-url.ts")
const { asFailure } = await load<{
  asFailure: (error: unknown) => { _tag: string; message: string }
}>("base/files/web/src/lib/failure.ts")

it("authBaseURL: BETTER_AUTH_URL wins whenever it is set, in dev too", () => {
  const local = { allowedHosts: ["localhost:*", "127.0.0.1:*"], protocol: "http" }
  expect(authBaseURL("http://192.168.1.20:5173", true)).toBe("http://192.168.1.20:5173")
  expect(authBaseURL("https://rentals.example.org", false)).toBe("https://rentals.example.org")
  // unset, empty, or still the .env.example value
  for (const unset of [undefined, "", "https://app.example.com"]) {
    expect(authBaseURL(unset, true)).toEqual(local)
    expect(authBaseURL(unset, false)).toBeUndefined()
  }
})

const { checkSettings } = await load<{
  checkSettings: <A, E, R>(layer: Layer.Layer<A, E, R>) => Layer.Layer<A, unknown, R>
}>("base/files/web/src/server/settings.ts")

it("checkSettings: a layer that misses a setting fails with NotConfigured, naming it and the file", async () => {
  const layer = Layer.effectDiscard(
    Effect.gen(function* () {
      yield* Config.String("RESEND_API_KEY")
    }),
  ).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))))
  const exit = await Effect.runPromiseExit(Layer.build(checkSettings(layer)).pipe(Effect.scoped))
  expect(Exit.isFailure(exit)).toBe(true)
  const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
  expect(error).toBeInstanceOf(Error)
  expect(error).toMatchObject({
    _tag: "NotConfigured",
    setting: "RESEND_API_KEY",
    file: ".dev.vars",
    message: "RESEND_API_KEY is not set. Set RESEND_API_KEY in .dev.vars and restart pnpm dev.",
  })
})

const { asNotConfigured } = await load<{
  asNotConfigured: (error: unknown) => { setting: string; problem: string; message: string }
}>("base/files/web/src/server/settings.ts")

it("asNotConfigured: every configuration error names its setting, and keeps a layer's own reason", () => {
  // a layer's own error with a `setting` field (StorageConfigError on cards-storage-email)
  expect(
    asNotConfigured({
      _tag: "StorageConfigError",
      setting: "STORAGE_SIGNING_SECRET",
      message: "STORAGE_SIGNING_SECRET is too short: use at least 32 characters.",
    }),
  ).toMatchObject({
    setting: "STORAGE_SIGNING_SECRET",
    problem: "STORAGE_SIGNING_SECRET is too short: use at least 32 characters.",
  })
  // one without the field, named only in its message (StorageConfigError on next)
  expect(
    asNotConfigured({
      _tag: "StorageConfigError",
      message: "STORAGE_SIGNING_SECRET must be at least 32 characters (wrangler secret put ...)",
    }),
  ).toMatchObject({ setting: "STORAGE_SIGNING_SECRET" })
  expect(
    asNotConfigured({ _tag: "LlmConfigError", message: "LLM_ENCRYPTION_KEY is not a 32-byte key" }),
  ).toMatchObject({ setting: "LLM_ENCRYPTION_KEY" })
  // the AI layer's LlmNotConfigured: an unusable value says so, not "is not set"
  expect(
    asNotConfigured({
      _tag: "LlmNotConfigured",
      setting: "LLM_PROVIDER",
      message: "LLM_PROVIDER must be one of: anthropic, openai, openrouter, ollama.",
    }),
  ).toMatchObject({
    setting: "LLM_PROVIDER",
    message:
      "LLM_PROVIDER must be one of: anthropic, openai, openrouter, ollama. Set LLM_PROVIDER in .dev.vars and restart pnpm dev.",
  })
  expect(asNotConfigured({ _tag: "NotFound", message: "X_Y" })).toBeUndefined()
})

/**
 * Every env var an add-on declares and a layer reads produces `NotConfigured` naming it when
 * missing: the layer reads it with `Config.*("NAME")` (an Effect ConfigError names the key), or
 * builds a `...ConfigError` that carries it. Read from the add-ons' own files, so a new add-on's
 * setting is checked without a change here.
 */
it("every env var an add-on reads in apps/web is read so that a missing one is named", async () => {
  const addons = await Effect.runPromise(
    loadAddons(templates).pipe(Effect.provide(NodeServices.layer)),
  )
  let checked = 0
  for (const { manifest, dir: addonDir } of addons.values()) {
    const sources = [...manifest.files, ...(manifest.card?.files ?? [])]
      .filter((f) => f.target.startsWith("apps/web/src/server/"))
      .map((f) => readFileSync(join(addonDir, f.path), "utf8"))
      .join("\n")
    for (const { name } of manifest.envVars) {
      if (!sources.includes(name)) continue
      const viaConfig = new RegExp(`Config\\.\\w+\\(\\s*"${name}"`).test(sources)
      const viaConst =
        new RegExp(`=\\s*"${name}"`).test(sources) && /Config\.\w+\(\s*[A-Z_]+\s*\)/.test(sources)
      expect(viaConfig || viaConst, `${manifest.id} reads ${name} without Config`).toBe(true)
      const missing = asNotConfigured({
        _tag: "ConfigError",
        message: `SchemaError(Expected string\n  at ["${name}"])`,
      })
      expect(missing.setting).toBe(name)
      expect(missing.message).toContain(name)
      checked++
    }
    // a layer's own `...ConfigError` must name a declared setting, in `setting` or its message
    const names = manifest.envVars.map((v) => v.name)
    for (const m of sources.matchAll(/new (\w+ConfigError)\(\{([\s\S]*?)\}\)/g)) {
      const message = /message:\s*[`"]([^`"]+)/.exec(m[2] ?? "")?.[1] ?? ""
      // `setting: "NAME"`, or `setting: SECRET` with `const SECRET = "NAME"`
      const field = /setting:\s*(?:"([A-Z0-9_]+)"|([A-Za-z_]\w*))/.exec(m[2] ?? "")
      const setting =
        field?.[1] ??
        (field?.[2] === undefined
          ? undefined
          : new RegExp(`const ${field[2]} = "([A-Z0-9_]+)"`).exec(sources)?.[1])
      const named = asNotConfigured({ _tag: m[1], message, ...(setting ? { setting } : {}) })
      expect(names, `${manifest.id}: ${m[1]} "${message}"`).toContain(named.setting)
      checked++
    }
  }
  expect(checked).toBeGreaterThanOrEqual(4)
})

const tagged = (tag: string, message: string) =>
  Object.assign(new Error(message), { _tag: tag, name: tag })

it("asFailure: a rejected call keeps its tag, and only a bug is a Defect", () => {
  // what requireSession rejects with, once it has crossed to the browser
  expect(asFailure(tagged("Unauthorized", "Not signed in"))).toEqual({
    _tag: "Unauthorized",
    message: "Not signed in",
  })
  expect(asFailure(tagged("NotConfigured", "BETTER_AUTH_SECRET is not set."))._tag).toBe(
    "NotConfigured",
  )
  // a Standard Schema validator's issues, as TanStack Start rejects with them
  const issues = JSON.stringify([
    { path: ["name"], message: "Expected a value with a length of at most 200" },
    { path: [{ key: "tags" }, 0], message: "Expected a string" },
  ])
  expect(asFailure(new Error(issues))).toEqual({
    _tag: "InvalidInput",
    message: "name: Expected a value with a length of at most 200; tags.0: Expected a string",
  })
  expect(asFailure(new TypeError("Failed to fetch"))._tag).toBe("Unreachable")
  expect(asFailure(new Error("Cannot read properties of undefined"))).toEqual({
    _tag: "Defect",
    message: "Cannot read properties of undefined",
  })
  expect(asFailure("boom")).toEqual({ _tag: "Defect", message: "boom" })
})

const { region, regions } = await load<{
  region: (source: string, name: string, file?: string) => string | undefined
  regions: () => {
    load: (this: unknown, id: string) => Promise<string | null>
  }
}>("base/files/web/regions.ts")

it("regions: a card gets only the marked region of a file, and a file without one fails the build", async () => {
  const source = [
    'import { Effect } from "effect"',
    "/** private: outside the region */",
    "  // #region card",
    "  export const shown = 1",
    "  // #endregion",
    "export const hidden = 2",
  ].join("\n")
  expect(region(source, "card")).toBe("export const shown = 1")
  expect(region("export const x = 1", "card")).toBeUndefined()

  const file = join(dir, "shown.ts")
  writeFileSync(file, source)
  writeFileSync(join(dir, "unmarked.ts"), "export const secret = 1\n")
  const context = {
    addWatchFile: () => {},
    error: (message: string) => {
      throw new Error(message)
    },
  }
  const plugin = regions()
  expect(await plugin.load.call(context, `${file}?region=card`)).toBe(
    'export default "export const shown = 1"\n',
  )
  expect(await plugin.load.call(context, file)).toBeNull()
  await expect(
    plugin.load.call(context, `${join(dir, "unmarked.ts")}?region=card`),
  ).rejects.toThrow(/has no complete "\/\/ #region card"/)
  // a marker inside a template string or a string is text, not a marker
  const inString = [
    "const doc = `",
    "// #region card",
    "export const notShown = 1",
    "// #endregion",
    "`",
    "// #region card",
    "export const shown = /[\"'`]/",
    "// #endregion",
  ].join("\n")
  expect(region(inString, "card", "doc.ts")).toBe("export const shown = /[\"'`]/")
  expect(region('const s = "\\\n// #region card\\\n"\n', "card", "s.ts")).toBeUndefined()
  // an #endregion inside a string does not end a region
  expect(
    region("// #region card\nconst s = `\n// #endregion\n`\n// #endregion", "card", "t.tsx"),
  ).toBe("const s = `\n// #endregion\n`")
  // a file that is not code is read line by line
  expect(region("# x\n// #region card\nshown\n// #endregion\n", "card", "notes.txt")).toBe("shown")
  // a region that runs into another region is not one: it would ship that region too
  expect(
    region("// #region card\nconst a = 1\n// #region other\nconst b = 2\n// #endregion", "card"),
  ).toBeUndefined()
})

const { wholeServerFile, secretValues } = await load<{
  wholeServerFile: (id: string) => string | undefined
  secretValues: (dirs: ReadonlyArray<string>) => Array<[string, string]>
}>("base/files/web/regions.ts")

it("clientGuard: a settings file or a whole server file in the browser build fails it", () => {
  const web = "/p/apps/web/src"
  expect(wholeServerFile(`${web}/server/auth-live.ts?raw`)).toMatch(/imported whole \(\?raw\)/)
  expect(wholeServerFile(`${web}/server/auth-live.ts?raw&region=card`)).toMatch(/\?raw/)
  expect(wholeServerFile(`${web}/server/notes.ts?url`)).toMatch(/\?url/)
  expect(wholeServerFile("/p/.dev.vars?raw")).toMatch(/settings file/)
  expect(wholeServerFile("/p/.env.local")).toMatch(/settings file/)
  // a server function's stub, a region, and anything outside src/server are fine
  expect(wholeServerFile(`${web}/server/notes.ts`)).toBeUndefined()
  expect(wholeServerFile(`${web}/server/notes.ts?region=card`)).toBeUndefined()
  expect(wholeServerFile(`${web}/styles.css?url`)).toBeUndefined()
  const settings = join(dir, "settings")
  mkdirSync(settings, { recursive: true })
  writeFileSync(
    join(settings, ".dev.vars"),
    "# local\nBETTER_AUTH_SECRET=dev-only-secret-0123456789\nBETTER_AUTH_URL=http://localhost:5173\nAPI_KEY=short\n",
  )
  expect(secretValues([settings])).toEqual([["BETTER_AUTH_SECRET", "dev-only-secret-0123456789"]])
})

/** The code panel fits this many characters at 1440 px wide (docs/capability-cards.md). */
const REGION_WIDTH = 80

const stacksWithCards = (["none", "better-auth", "better-auth-orgs"] as const)
  .flatMap((auth) =>
    (["drizzle", "effect-sql"] as const).flatMap((orm) =>
      (["d1", "postgres"] as const).map((database) =>
        (["none", "alchemy"] as const).map((infra) =>
          withDefaults({
            name: "app",
            database,
            orm,
            auth,
            infra,
            ai: "effect-ai-byok",
            extras: ["realtime", "storage", "email", "workflows", "browser"],
          }),
        ),
      ),
    ),
  )
  .flat()

it(`every region a registered card shows fits in ${REGION_WIDTH} characters, on every stack`, async () => {
  const addons = await Effect.runPromise(
    loadAddons(templates).pipe(Effect.provide(NodeServices.layer)),
  )
  const long: string[] = []
  let regionsChecked = 0
  for (const config of stacksWithCards) {
    const tree = await Effect.runPromise(
      generate(config, addons).pipe(Effect.provide(NodeServices.layer)),
    )
    for (const [file, text] of tree) {
      if (!file.startsWith("apps/web/src/") || !file.endsWith(".tsx")) continue
      for (const m of text.matchAll(/from "([^"]+)\?region=card"/g)) {
        const target = posix.normalize(posix.join(posix.dirname(file), m[1] as string))
        const shown = region(tree.get(target) ?? "", "card", target)
        expect(shown, `${file} shows ${target}, which has no card region`).toBeDefined()
        regionsChecked++
        for (const line of (shown ?? "").split("\n"))
          if (line.length > REGION_WIDTH)
            long.push(
              `${config.database}/${config.orm}/${config.auth} ${target}: ${line.length}: ${line}`,
            )
      }
    }
  }
  expect(regionsChecked).toBeGreaterThan(50)
  expect([...new Set(long)]).toEqual([])
}, 60_000)

const { rowSizes } = await load<{ rowSizes: (count: number, columns: number) => number[] }>(
  "base/files/web/src/lib/layer-graph.ts",
)

it("the layer graph leaves no layer alone on a row, for one to twelve layers at three and four columns", () => {
  for (const columns of [3, 4])
    for (let count = 1; count <= 12; count++) {
      const rows = rowSizes(count, columns)
      expect(
        rows.reduce((a, b) => a + b, 0),
        `${count} in ${columns}`,
      ).toBe(count)
      expect(Math.max(...rows), `${count} in ${columns}`).toBeLessThanOrEqual(columns)
      if (count > 1)
        expect(Math.min(...rows), `${count} in ${columns}: ${rows.join(" ")}`).toBeGreaterThan(1)
    }
  // nine layers, the stack with everything, at the README's width
  expect(rowSizes(9, 4)).toEqual([3, 3, 3])
})
