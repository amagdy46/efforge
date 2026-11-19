// Records what one efforge release generates, for `upgrade` (src/history.ts): its pins, the
// dependencies, scripts and `engines` of each package.json, and a fingerprint record of each file
// it edits in place. Run it at release time, from the release's own source:
//
//   node scripts/history.ts                      # this checkout, as its package.json version
//   node scripts/history.ts --source <dir>       # another checkout (git archive v0.2.0, installed)
//
// It renders every stack the release allows (each database, ORM, auth, infra and AI choice, with
// no extras and with all of them) in memory, takes the union, and writes the entry into
// src/history.data.ts. The test in test/history.test.ts fails while this efforge's version is
// missing.

import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { encodeRecord, shingles } from "../src/record.ts"

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i < 0 ? undefined : process.argv[i + 1]
}
const source = resolve(arg("source") ?? new URL("..", import.meta.url).pathname)
const out = new URL("../src/history.data.ts", import.meta.url).pathname
const NAME = "efforge-history-app"

const load = async (rel: string) => import(pathToFileURL(join(source, rel)).href)
// the release's own copies, with its own effect
const { Effect, Exit } = await import(
  pathToFileURL(join(source, "node_modules/effect/dist/index.js")).href
)
const { NodeServices } = await import(
  pathToFileURL(join(source, "node_modules/@effect/platform-node/dist/index.js")).href
)
const { loadAddons } = await load("src/addon.ts")
const { generate, isComputed } = await load("src/generate.ts")
const { withDefaults } = await load("src/stack.ts")
const { validate } = await load("src/rules.ts")
const { slots } = await load("src/slots.ts")
const { versions } = await load("src/versions.ts")
const version = String(JSON.parse(readFileSync(join(source, "package.json"), "utf8")).version)

const run = <A>(eff: unknown): Promise<A> =>
  Effect.runPromise(Effect.provide(eff, NodeServices.layer)) as Promise<A>

const addons = await run<ReadonlyMap<string, unknown>>(loadAddons(join(source, "templates")))

const options = (id: string): string[] =>
  (slots as Array<{ id: string; options: Array<{ id: string }> }>)
    .find((s) => s.id === id)
    ?.options.map((o) => o.id) ?? []

const extras = options("extras").filter((x) => x !== "none")
const stacks: unknown[] = []
for (const database of options("database"))
  for (const orm of options("orm"))
    for (const auth of options("auth"))
      for (const infra of options("infra"))
        for (const ai of options("ai"))
          for (const ex of [[], extras]) {
            const stack = withDefaults({ name: NAME, database, orm, auth, infra, ai, extras: ex })
            if (Exit.isSuccess(Effect.runSyncExit(validate(stack)))) stacks.push(stack)
          }

const deps = new Map<string, Set<string>>()
const scripts = new Map<string, Map<string, Set<string>>>()
/** path -> script -> the stacks that got it */
const scriptStacks = new Map<string, Map<string, Array<Record<string, unknown>>>>()
const records = new Map<string, Set<number>>()
let engines: unknown = null
let pnpm: string | undefined
for (const stack of stacks) {
  const tree = await run<ReadonlyMap<string, string>>(generate(stack, addons))
  const manifest = JSON.parse((tree.get("efforge.jsonc") ?? "{}").replace(/^\/\/.*\n/, "")) as {
    files?: Record<string, string>
  }
  for (const [path, text] of tree) {
    if (path === "package.json" || path.endsWith("/package.json")) {
      const pkg = JSON.parse(text) as Record<string, Record<string, string> | string | undefined>
      const names = deps.get(path) ?? new Set<string>()
      for (const field of ["dependencies", "devDependencies"])
        for (const n of Object.keys((pkg[field] as Record<string, string>) ?? {})) names.add(n)
      deps.set(path, names)
      const byName = scripts.get(path) ?? new Map<string, Set<string>>()
      const stacksOf = scriptStacks.get(path) ?? new Map<string, Array<Record<string, unknown>>>()
      for (const [n, cmd] of Object.entries((pkg.scripts as Record<string, string>) ?? {})) {
        byName.set(n, (byName.get(n) ?? new Set()).add(cmd))
        stacksOf.set(n, [...(stacksOf.get(n) ?? []), stack as Record<string, unknown>])
      }
      scripts.set(path, byName)
      scriptStacks.set(path, stacksOf)
      if (path === "package.json") {
        engines ??= pkg.engines ?? null
        const pm = pkg.packageManager
        pnpm ??= typeof pm === "string" ? /^pnpm@(.+)$/.exec(pm)?.[1] : undefined
      }
      continue
    }
    if (
      isComputed(path) ||
      path in (manifest.files ?? {}) ||
      path === ".dev.vars" ||
      path === ".env"
    )
      continue
    const set = records.get(path) ?? new Set<number>()
    for (const x of shingles(text, NAME)) set.add(x)
    records.set(path, set)
  }
}

// A script only some stacks get: for each slot that narrows it, the values of the stacks that got
// it; for extras, the extras each of them had (a project with any of them counts). Wider than
// exact, so a script a release may have written is never taken for a new one.
const narrowing = (got: ReadonlyArray<Record<string, unknown>>) => {
  const out: Record<string, string[]> = {}
  for (const slot of ["database", "orm", "auth", "infra", "ai"]) {
    const all = new Set(stacks.map((s) => String((s as Record<string, unknown>)[slot])))
    const seen = new Set(got.map((s) => String(s[slot])))
    if (seen.size < all.size) out[slot] = [...seen].toSorted()
  }
  const each = got.map((s) => (s.extras as string[]) ?? [])
  if (each.every((x) => x.length > 0)) {
    const common = each.reduce((a, b) => a.filter((x) => b.includes(x)))
    out.extras = common.toSorted()
  }
  return out
}

const sorted = <V>(m: Map<string, V>) => [...m].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
const entry = {
  pnpm: pnpm ?? null,
  pins: Object.fromEntries(
    Object.entries(versions as Record<string, string>).toSorted(([a], [b]) => (a < b ? -1 : 1)),
  ),
  engines,
  dependencies: Object.fromEntries(sorted(deps).map(([p, s]) => [p, [...s].toSorted()])),
  scripts: Object.fromEntries(
    sorted(scripts).map(([p, m]) => [
      p,
      Object.fromEntries(sorted(m).map(([n, s]) => [n, [...s].toSorted()])),
    ]),
  ),
  scriptStacks: Object.fromEntries(
    sorted(scriptStacks)
      .map(([p, m]) => [
        p,
        Object.fromEntries(
          sorted(m)
            .map(([n, got]) => [n, narrowing(got)] as const)
            .filter(([, w]) => Object.keys(w).length > 0),
        ),
      ])
      .filter(([, m]) => Object.keys(m as object).length > 0),
  ),
  records: Object.fromEntries(sorted(records).map(([p, s]) => [p, encodeRecord(s)])),
}

// merge into the data file, releases in version order
let existing: Record<string, unknown> = {}
try {
  const text = readFileSync(out, "utf8")
  existing = JSON.parse(text.slice(text.indexOf("= {") + 2, text.lastIndexOf("}") + 1))
} catch {}
existing[version] = entry
const ordered = Object.fromEntries(
  Object.entries(existing).toSorted(([a], [b]) => {
    const pa = a.split(/[.-]/).map(Number)
    const pb = b.split(/[.-]/).map(Number)
    for (let i = 0; i < 3; i++)
      if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
    return 0
  }),
)
writeFileSync(
  out,
  `// Generated by scripts/history.ts at each release; don't edit. What each efforge release generated:\n// see src/history.ts.\nimport type { Release } from "./history.ts"\n\nexport const releases: Readonly<Record<string, Release>> = ${JSON.stringify(ordered, null, 2)}\n`,
)
console.log(`${version}: ${stacks.length} stacks, ${records.size} files edited in place`)
