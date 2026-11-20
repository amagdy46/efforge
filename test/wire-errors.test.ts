import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { afterAll, expect, it } from "@effect/vitest"
import { Cause, Data, Effect, Exit, Path, Schema } from "effect"
import { loadAddons } from "../src/addon.ts"

// A server function returns its Effect's Exit, encoded (apps/web/src/server/outcome.ts), and the
// browser decodes it back into the error's class with its fields (apps/web/src/lib/outcome.ts).
// Here the real template modules carry an error through JSON, as TanStack Start would.

const templates = new URL("../templates", import.meta.url).pathname
const base = join(templates, "base/files")
// copied out of templates/, whose tsconfig.json files point at the generated project's
const cache = join(templates, "../node_modules/.cache")
mkdirSync(cache, { recursive: true })
const tmp = mkdtempSync(join(cache, "efforge-wire-"))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
copyFileSync(join(base, "web/src/lib/outcome.ts"), join(tmp, "outcome.ts"))
copyFileSync(join(base, "core/src/server-only.ts"), join(tmp, "server-only.ts"))
const { decodeOutcome, failureCodec, NotConfigured } = (await import(
  join(tmp, "outcome.ts")
)) as typeof import("../templates/base/files/web/src/lib/outcome.ts")
const { ServerOnly } = (await import(
  join(tmp, "server-only.ts")
)) as typeof import("../templates/base/files/core/src/server-only.ts")

class FileTooLarge extends Schema.TaggedError<FileTooLarge, { readonly brand: unique symbol }>()(
  "FileTooLarge",
  { message: Schema.String, limit: Schema.Number, cause: ServerOnly },
) {}
class OwnersOwn extends Data.TaggedError("OwnersOwn")<{ readonly message: string }> {}

/** What runOutcome sends for a failure with `error`, through JSON as the wire would. */
const wire = (error: unknown, errors: ReadonlyArray<typeof FileTooLarge> = [FileTooLarge]) =>
  JSON.parse(
    JSON.stringify({
      _tag: "Failure",
      cause: Schema.encodeSync(failureCodec(errors))(Cause.fail(error as FileTooLarge)),
    }),
  ) as { _tag: "Failure"; cause: unknown }

const failure = <E>(exit: Exit.Exit<unknown, E>) =>
  Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : undefined

it("a listed tagged error arrives as its class, with its fields, and its cause stays behind", () => {
  const sent = wire(
    new FileTooLarge({ message: "Too big", limit: 3, cause: new Error("r2: internal detail") }),
  )
  expect(JSON.stringify(sent)).not.toContain("internal detail")
  const error = failure(decodeOutcome(sent, [FileTooLarge]))
  expect(error?._tag).toBe("Some")
  const value = error?._tag === "Some" ? error.value : undefined
  expect(value).toBeInstanceOf(FileTooLarge)
  expect(value).toMatchObject({ _tag: "FileTooLarge", message: "Too big", limit: 3 })
})

it("NotConfigured always arrives as itself; an unlisted Data.TaggedError keeps its tag and message", () => {
  const missing = new NotConfigured({
    setting: "MAIL_FROM",
    file: ".dev.vars",
    problem: "MAIL_FROM is not set.",
    message: "MAIL_FROM is not set. Set MAIL_FROM in .dev.vars and restart pnpm dev.",
  })
  const a = failure(decodeOutcome(wire(missing, []), []))
  expect(a?._tag === "Some" && a.value).toBeInstanceOf(NotConfigured)
  const b = failure(decodeOutcome(wire(new OwnersOwn({ message: "ours" }), []), []))
  expect(b?._tag === "Some" && b.value).toEqual({ _tag: "OwnersOwn", message: "ours" })
  expect(decodeOutcome({ _tag: "Success", value: 1 }, [])).toEqual(Exit.succeed(1))
  // a server function upgrade kept from before 0.3 still answers { ok, value | error }
  expect(decodeOutcome({ ok: true, value: 1 }, [])).toEqual(Exit.succeed(1))
  const earlier = failure(decodeOutcome({ ok: false, error: { _tag: "Old", message: "m" } }, []))
  expect(earlier?._tag === "Some" && earlier.value).toEqual({ _tag: "Old", message: "m" })
})

it("every core service error is a Schema.TaggedError, so it can cross the wire", async () => {
  const addons = await Effect.runPromise(
    loadAddons(templates).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Path.layer)),
  )
  const data: string[] = []
  for (const [id, { dir, manifest }] of addons)
    for (const f of manifest.files)
      if (/^packages\/core\/src\/.*\.ts$/.test(f.target)) {
        const text = readFileSync(join(dir, f.path), "utf8")
        for (const m of text.matchAll(/class (\w+) extends Data\.TaggedError/g))
          data.push(`${id} ${f.target}: ${m[1]}`)
      }
  expect(data).toEqual([])
})
