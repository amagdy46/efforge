import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { basename, join, posix } from "node:path"
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
const load = async <M>(path: string): Promise<M> => {
  const copy = join(dir, basename(path))
  copyFileSync(join(templates, path), copy)
  return (await import(copy)) as M
}
// what server/manifest.ts reads from efforge.jsonc
writeFileSync(join(dir, "manifest.ts"), 'export const stack = { infra: "none" }\n')

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
    message: "RESEND_API_KEY is not set. Add it to .dev.vars and restart pnpm dev.",
  })
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
  region: (source: string, name: string) => string | undefined
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
  ).rejects.toThrow(/has no "\/\/ #region card"/)
})

/** The code panel fits this many characters at 1440 px wide (docs/capability-cards.md). */
const REGION_WIDTH = 80

const stacksWithCards = (["none", "better-auth", "better-auth-orgs"] as const).flatMap((auth) =>
  (["drizzle", "effect-sql"] as const).flatMap((orm) =>
    (["d1", "postgres"] as const).map((database) =>
      withDefaults({ name: "app", database, orm, auth, infra: "none", extras: ["realtime"] }),
    ),
  ),
)

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
        const shown = region(tree.get(target) ?? "", "card")
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
})
