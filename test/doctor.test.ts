import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { stripVTControlCharacters } from "node:util"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { afterEach, expect, it, vi } from "vitest"
import { parseDocument } from "yaml"
import { type LoadedAddon, loadAddons } from "../src/addon.ts"
import { runWith } from "../src/cli.ts"
import { defaultTemplatesDir } from "../src/commands/create.ts"
import { readManifest } from "../src/commands/add.ts"
import {
  type CheckResult,
  checks,
  classifyPeers,
  configReads,
  DoctorProbe,
  doctorContext,
  liveProbe,
  type Probe,
  runChecks,
} from "../src/doctor.ts"
import { generate } from "../src/generate.ts"
import { type StackConfig, withDefaults } from "../src/stack.ts"
import { PromptIOLive } from "../src/prompts/navigable.ts"
import { pnpmVersion } from "../src/versions.ts"
import { recordingSpawner } from "./recordingSpawner.ts"

// Each doctor check, proven with a project broken in exactly that way. The outside world (Node,
// pnpm, peers, the database port) is a stub; the files are real, as `create --no-install` writes them.

// each test renders a project and plans an upgrade; under a full parallel run that takes a while
vi.setConfig({ testTimeout: 60_000 })

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

const run = <A>(eff: Effect.Effect<A, unknown>) => Effect.runPromise(eff)
let addons: ReadonlyMap<string, LoadedAddon> | undefined
const loaded = async () =>
  (addons ??= await run(loadAddons(defaultTemplatesDir).pipe(Effect.provide(NodeServices.layer))))

const project = async (partial: Partial<StackConfig> = {}): Promise<string> => {
  const dir = mkdtempSync(join(tmpdir(), "efforge-doctor-"))
  roots.push(dir)
  const stack = withDefaults({
    name: "my-app",
    database: "d1",
    orm: "effect-sql",
    auth: "better-auth",
    ...partial,
  })
  const tree = await run(generate(stack, await loaded()).pipe(Effect.provide(NodeServices.layer)))
  for (const [file, content] of tree) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), content)
  }
  return dir
}

const healthy: Probe = {
  ...liveProbe,
  nodeVersion: () => "24.11.1",
  pnpmVersion: () => pnpmVersion,
  peers: () => "{}",
  reachable: () => Effect.succeed(true),
}

// run from the project, as people do, so fixes have no `cd`
const doctor = async (dir: string, probe: Partial<Probe> = {}, online = false) => {
  const before = process.cwd()
  process.chdir(dir)
  try {
    return await doctorIn(dir, probe, online)
  } finally {
    process.chdir(before)
  }
}

const doctorIn = async (dir: string, probe: Partial<Probe>, online: boolean) =>
  run(
    Effect.gen(function* () {
      const m = yield* readManifest(dir).pipe(
        Effect.map((x) => ({ m: x, problem: undefined as string | undefined })),
        Effect.catch((e) => Effect.succeed({ m: undefined, problem: e.reason })),
      )
      const ctx = doctorContext({
        dir,
        manifest: m.m,
        manifestProblem: m.problem,
        all: yield* Effect.promise(loaded),
        online,
        probe: { ...healthy, ...probe },
        engines: "^24.11.0 || >=26.0.0",
      })
      return yield* runChecks(ctx)
    }).pipe(Effect.provide(NodeServices.layer)),
  )

const get = (results: ReadonlyArray<CheckResult>, id: string) =>
  results.find((r) => r.id === id) as CheckResult

const edit = (dir: string, file: string, f: (text: string) => string) =>
  writeFileSync(join(dir, file), f(readFileSync(join(dir, file), "utf8")))

/** What pnpm leaves after installing: the marker, and a lockfile resolving `packages`. */
const installed = (dir: string, packages: ReadonlyArray<string>) => {
  mkdirSync(join(dir, "node_modules/.pnpm"), { recursive: true })
  writeFileSync(join(dir, "node_modules/.modules.yaml"), "layoutVersion: 5\n")
  writeFileSync(
    join(dir, "node_modules/.pnpm/lock.yaml"),
    `lockfileVersion: '9.0'\n\npackages:\n\n${packages.map((p) => `  '${p}':\n    resolution: {integrity: sha512-x}\n`).join("\n")}`,
  )
}

it("every check has a stable, unique id", () => {
  const ids = checks.map((c) => c.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(ids).toEqual([
    "node",
    "pnpm",
    "manifest",
    "install",
    "effect",
    "effect-guard",
    "peers",
    "env",
    "bindings",
    "migrations",
    "postgres",
    "layers",
    "upgrade",
  ])
})

it("a fresh project, not installed: only install fails, and migrations are pending", async () => {
  const r = await doctor(await project())
  const bad = r.filter((x) => x.status === "fail" || x.status === "warn").map((x) => x.id)
  expect(bad).toEqual(["install", "migrations"])
  expect(get(r, "install").fix).toContain("pnpm install --no-frozen-lockfile")
  expect(get(r, "upgrade").status).toBe("ok")
})

it("node: an unsupported version fails", async () => {
  const r = await doctor(await project(), { nodeVersion: () => "22.3.0" })
  expect(get(r, "node")).toMatchObject({ status: "fail" })
  expect(get(r, "node").message).toContain("^24.11.0 || >=26.0.0")
})

it("pnpm: missing fails with the install; a packageManager below 12.17 fails with the edit", async () => {
  const dir = await project()
  expect(get(await doctor(dir, { pnpmVersion: () => undefined }), "pnpm")).toMatchObject({
    status: "fail",
    fix: "npm install --global pnpm",
  })
  edit(dir, "package.json", (t) => t.replace(`pnpm@${pnpmVersion}`, "pnpm@12.4.2"))
  const low = get(await doctor(dir), "pnpm")
  expect(low.status).toBe("fail")
  expect(low.fix).toContain(`npm pkg set packageManager=pnpm@${pnpmVersion}`)
})

it("manifest: an invalid efforge.jsonc fails, and the checks that need the stack skip", async () => {
  const dir = await project()
  edit(dir, "efforge.jsonc", (t) => t.replace('"database": "d1"', '"database": "mysql"'))
  const r = await doctor(dir)
  expect(get(r, "manifest").status).toBe("fail")
  for (const id of ["env", "bindings", "migrations", "postgres", "layers", "upgrade"])
    expect(get(r, id).status, id).toBe("skipped")
})

it("install: a dependency declared after the last install fails", async () => {
  const dir = await project()
  installed(dir, ["effect@4.1.4"])
  // no current lockfile importers: pnpm's record says nothing was installed for the workspace
  const r = await doctor(dir)
  expect(get(r, "install").status).toBe("fail")
})

it("effect: one package at another version is two Effects, named in one line", async () => {
  const dir = await project()
  installed(dir, [
    "effect@4.1.4",
    "@effect/sql-d1@4.1.4",
    "@effect/sql-sqlite-do@4.2.0",
    "effect@3.17.7", // a library's own Effect 3 is fine (ADR 0005)
  ])
  const r = get(await doctor(dir), "effect")
  expect(r.status).toBe("fail")
  expect(r.message).toContain("@effect/sql-sqlite-do 4.2.0")
  expect(r.message).not.toContain("3.17.7")
  // the overrides are there, so a fresh install fixes it
  expect(r.fix).toBe("pnpm install --no-frozen-lockfile")
})

it("effect: without the overrides, the fix is upgrade, which writes them and installs", async () => {
  const dir = await project()
  edit(dir, "pnpm-workspace.yaml", (t) => {
    const doc = parseDocument(t)
    doc.setIn(["catalog", "effect"], "4.0.5")
    doc.setIn(["overrides"], { vite: "catalog:" })
    return doc.toString()
  })
  installed(dir, ["effect@4.0.5", "@effect/sql-d1@4.1.4"])
  const r = await doctor(dir)
  expect(get(r, "effect").fix).toBe("npx -y create-efforge upgrade")
  expect(get(r, "effect-guard")).toMatchObject({
    status: "warn",
    fix: "npx -y create-efforge upgrade",
  })
})

// ruling 9: a fix is a command after which the check passes; upgrade refuses uncommitted changes
it("effect-guard: with uncommitted changes there is no fix, and the facts say why", async () => {
  const dir = await project()
  edit(dir, "pnpm-workspace.yaml", (t) => {
    const doc = parseDocument(t)
    doc.setIn(["overrides"], { vite: "catalog:" })
    return doc.toString()
  })
  const r = get(await doctor(dir, { dirty: () => ["pnpm-workspace.yaml"] }), "effect-guard")
  expect(r.fix).toBeNull()
  expect(r.details).toMatchObject({
    command: "npx -y create-efforge upgrade",
    uncommitted: ["pnpm-workspace.yaml"],
  })
})

it("peers: unmet ones fail; the known upstream Alchemy issue and optional peers don't", () => {
  const report = {
    "apps/web": {
      bad: {
        unenv: [
          {
            optional: false,
            wantedRange: "2.0.0-rc.24",
            foundVersion: "2.0.0-rc.25",
            parents: [
              { name: "@alchemy.run/cloudflare-runtime" },
              { name: "@cloudflare/unenv-preset" },
            ],
          },
        ],
        typescript: [
          {
            optional: true,
            wantedRange: "^5 || ^6",
            foundVersion: "7.0.2",
            parents: [{ name: "capnp-es" }],
          },
        ],
        effect: [
          {
            optional: false,
            wantedRange: "^4.1.4",
            foundVersion: "4.0.5",
            parents: [{ name: "@effect/sql-d1" }],
          },
        ],
      },
      missing: {},
    },
  }
  const { unmet, known } = classifyPeers(report)
  expect(unmet).toEqual(["apps/web: effect 4.0.5, wanted ^4.1.4 by @effect/sql-d1"])
  expect(known).toHaveLength(2)
})

it("peers: skipped when the pinned pnpm differs from PATH's, unless --online", async () => {
  const dir = await project()
  installed(dir, ["effect@4.1.4"])
  const other = { pnpmVersion: () => "12.4.2" }
  expect(get(await doctor(dir, other), "peers").status).toBe("skipped")
  expect(get(await doctor(dir, other, true), "peers").status).toBe("ok")
})

it("env: a blanked secret fails; the fix puts efforge's public local value back, and no other value shows", async () => {
  const dir = await project()
  edit(dir, ".dev.vars", (t) =>
    t
      .replace(/^BETTER_AUTH_SECRET=.*$/m, "BETTER_AUTH_SECRET=")
      .concat("MY_TOKEN=s3cr3t-of-mine\n"),
  )
  const r = get(await doctor(dir), "env")
  expect(r.status).toBe("fail")
  expect(r.message).toContain("BETTER_AUTH_SECRET (empty)")
  expect(JSON.stringify(r)).not.toMatch(/s3cr3t-of-mine/)
  // the empty line is replaced, not followed by a second one
  expect(r.fix).toBe(
    "{ grep -v -E '^(BETTER_AUTH_SECRET)=' .dev.vars; printf '%s\\n' BETTER_AUTH_SECRET=dev-only-secret-replace-me-with-openssl-rand-base64-32; } > .dev.vars.new && mv .dev.vars.new .dev.vars",
  )
})

it("env: no .dev.vars at all fails, and the fix writes efforge's local values", async () => {
  const dir = await project()
  rmSync(join(dir, ".dev.vars"))
  const r = get(await doctor(dir), "env")
  expect(r.status).toBe("fail")
  expect(r.fix).toMatch(/^printf '%s\\n' '?BETTER_AUTH_SECRET=dev-only-[^' ]*'? >> \.dev\.vars$/)
})

it("env: with Alchemy and no .env, the fix copies .env.example, which has the same lines", async () => {
  const dir = await project({ infra: "alchemy" })
  rmSync(join(dir, ".env"))
  const r = get(await doctor(dir), "env")
  expect(r).toMatchObject({ status: "fail", fix: "cp .env.example .env" })
})

it("env: a value that is only a comment is empty", async () => {
  const dir = await project()
  edit(dir, ".dev.vars", (t) =>
    t.replace(/^BETTER_AUTH_SECRET=.*$/m, "BETTER_AUTH_SECRET=   # todo"),
  )
  const r = get(await doctor(dir), "env")
  expect(r.status).toBe("fail")
  expect(r.message).toContain("BETTER_AUTH_SECRET (empty)")
})

it("pnpm: another package manager is named, not called missing", async () => {
  const dir = await project()
  edit(dir, "package.json", (t) => t.replace(`"pnpm@${pnpmVersion}"`, '"yarn@4.5.0"'))
  expect(get(await doctor(dir), "pnpm").message).toContain("yarn@4.5.0")
})

it("node: engines with a space after the operator", async () => {
  const dir = await project()
  edit(dir, "package.json", (t) => t.replace(/"node": "[^"]*"/, '"node": ">= 24"'))
  expect(get(await doctor(dir, { nodeVersion: () => "26.13.1" }), "node").status).toBe("ok")
})

it("env: a secret efforge writes empty for you to fill in warns, and isn't a failure", async () => {
  const dir = await project({ ai: "effect-ai-byok" })
  const r = get(await doctor(dir), "env")
  expect(r.status).toBe("warn")
  expect(r.message).toContain("LLM_API_KEY (yours to fill in)")
})

it("env: a production placeholder warns", async () => {
  const dir = await project()
  edit(dir, ".dev.vars", (t) =>
    t.replace(/^BETTER_AUTH_SECRET=.*$/m, "BETTER_AUTH_SECRET=change-me-to-a-long-random-string"),
  )
  const r = get(await doctor(dir), "env")
  expect(r.status).toBe("warn")
  expect(r.message).toContain("BETTER_AUTH_SECRET (placeholder)")
})

it("env: what the code reads, and whether it has a default", () => {
  expect(
    configReads(`
      Config.Redacted("A").parse(p)
      Config.option(Config.String("B"))
      Config.String("C").pipe(Config.withDefault("x"))
    `),
  ).toEqual([
    { name: "A", required: true },
    { name: "B", required: false },
    { name: "C", required: false },
  ])
})

it("bindings: a deleted D1 binding fails, with the entry to add", async () => {
  const dir = await project()
  edit(dir, "wrangler.jsonc", (t) =>
    t.replace(/"d1_databases": \[[\s\S]*?\]/, '"d1_databases": []'),
  )
  const r = get(await doctor(dir), "bindings")
  expect(r.status).toBe("fail")
  expect(r.message).toContain("d1_databases DB (database/d1)")
  expect(r.details?.missing).toMatchObject([{ key: "d1_databases", value: { binding: "DB" } }])
})

it("bindings: with Alchemy, a deleted resource fails", async () => {
  const dir = await project({ infra: "alchemy", extras: ["storage"] })
  edit(dir, "infra/alchemy.run.ts", (t) => t.replace(/^\s*STORAGE: storage,\n/m, ""))
  const r = get(await doctor(dir), "bindings")
  expect(r.status).toBe("fail")
  expect(r.message).toContain("STORAGE")
})

// ruling 10: read as code, not text
it("bindings: with Alchemy, a commented-out binding fails and a renamed variable passes", async () => {
  const dir = await project({ infra: "alchemy", extras: ["storage"] })
  edit(dir, "infra/alchemy.run.ts", (t) =>
    t.replace(/^(\s*)STORAGE: storage,$/m, "$1// STORAGE: storage,"),
  )
  expect(get(await doctor(dir), "bindings").status).toBe("fail")
  edit(dir, "infra/alchemy.run.ts", (t) =>
    t
      .replace(/^(\s*)\/\/ STORAGE: storage,$/m, "$1STORAGE: uploads,")
      .replace("const storage = ", "const uploads = "),
  )
  expect(get(await doctor(dir), "bindings").status).toBe("ok")
})

it("bindings: with Alchemy and no env object efforge can find, it could not verify", async () => {
  const dir = await project({ infra: "alchemy", extras: ["storage"] })
  edit(dir, "infra/alchemy.run.ts", (t) => t.replace(/\benv: \{/, "env: {}, more: {"))
  const r = get(await doctor(dir), "bindings")
  expect(r.status === "fail" || r.status === "unverified").toBe(true)
  edit(dir, "infra/alchemy.run.ts", (t) => t.replace("env: {}, more: {", "more: {"))
  const u = get(await doctor(dir), "bindings")
  expect(u.status).toBe("unverified")
  expect(u.details?.lookedFor).toContain("STORAGE")
})

it("migrations: pending ones warn; all applied is ok", async () => {
  const dir = await project()
  const state = join(dir, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject")
  mkdirSync(state, { recursive: true })
  const db = new DatabaseSync(join(state, "abc.sqlite"))
  db.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT)")
  db.exec("INSERT INTO d1_migrations (name) VALUES ('0001_init.sql')")
  const pending = get(await doctor(dir), "migrations")
  expect(pending.status).toBe("warn")
  expect(pending.details?.pending).toEqual(["0002_auth.sql"])
  db.exec("INSERT INTO d1_migrations (name) VALUES ('0002_auth.sql')")
  db.close()
  expect(get(await doctor(dir), "migrations").status).toBe("ok")
})

it("postgres: nothing answering warns with docker compose; it never starts anything", async () => {
  const dir = await project({ database: "postgres", orm: "drizzle" })
  const asked: string[] = []
  const r = get(
    await doctor(dir, {
      reachable: (host, port) => Effect.sync(() => (asked.push(`${host}:${port}`), false)),
    }),
    "postgres",
  )
  expect(r).toMatchObject({ status: "warn", fix: "docker compose up -d --wait" })
  expect(asked).toEqual(["localhost:5432"])
})

it("layers: a layer removed from AppLayer fails", async () => {
  const dir = await project()
  edit(dir, "apps/web/src/server/layers.ts", (t) => t.replace(/^\s*AuthLive,\n/m, ""))
  const r = get(await doctor(dir), "layers")
  expect(r.status).toBe("fail")
  expect(r.message).toContain("AuthLive (auth/better-auth)")
})

it("layers: a commented-out layer fails; AppLayer built from another const passes", async () => {
  const dir = await project()
  edit(dir, "apps/web/src/server/layers.ts", (t) =>
    t.replace(/^(\s*)AuthLive,$/m, "$1// AuthLive,"),
  )
  expect(get(await doctor(dir), "layers").status).toBe("fail")
  edit(dir, "apps/web/src/server/layers.ts", (t) =>
    t
      .replace(/^(\s*)\/\/ AuthLive,$/m, "$1AuthLive,")
      .replace("export const AppLayer = Layer.mergeAll(", "const Base = Layer.mergeAll(")
      .concat("\nexport const AppLayer = Base.pipe(Layer.orDie)\n"),
  )
  expect(get(await doctor(dir), "layers").status).toBe("ok")
})

it("layers: a layer replaced by one of yours could not be verified, and isn't a failure", async () => {
  const dir = await project()
  edit(dir, "apps/web/src/server/layers.ts", (t) =>
    t
      .replace('import { AuthLive } from "./auth-live"', 'import { MyAuthLive } from "./my-auth"')
      .replace(/^(\s*)AuthLive,$/m, "$1MyAuthLive,"),
  )
  const results = await doctor(dir)
  const r = get(results, "layers")
  expect(r.status).toBe("unverified")
  expect(r.message).toContain("AuthLive")
})

it("upgrade: needs action fails with upgrade as the fix; behind warns; current is ok", async () => {
  const dir = await project()
  expect(get(await doctor(dir), "upgrade").status).toBe("ok")
  edit(dir, "efforge.jsonc", (t) =>
    t.replace(/"efforgeVersion": "[^"]*"/, '"efforgeVersion": "0.2.0"'),
  )
  const behind = get(await doctor(dir), "upgrade")
  expect(behind).toMatchObject({ status: "warn", fix: "npx -y create-efforge upgrade" })
  edit(dir, "package.json", (t) => t.replace(`pnpm@${pnpmVersion}`, "pnpm@12.4.2"))
  const r = get(await doctor(dir), "upgrade")
  expect(r).toMatchObject({ status: "fail", fix: "npx -y create-efforge upgrade" })
})

it("peers: run when the pinned pnpm made node_modules, even with another pnpm on PATH", async () => {
  const dir = await project()
  installed(dir, [])
  writeFileSync(
    join(dir, "node_modules/.modules.yaml"),
    `{"packageManager": "pnpm@${pnpmVersion}"}\n`,
  )
  let ran = false
  const r = get(
    await doctor(dir, {
      pnpmVersion: () => "12.4.2",
      peers: () => ((ran = true), "{}"),
    }),
    "peers",
  )
  expect(ran).toBe(true)
  expect(r.status).toBe("ok")
  writeFileSync(join(dir, "node_modules/.modules.yaml"), '{"packageManager": "pnpm@12.4.2"}\n')
  const skipped = get(await doctor(dir, { pnpmVersion: () => "12.4.2" }), "peers")
  expect(skipped.status).toBe("skipped")
  expect(skipped.message).toContain("pnpm peers check")
})

// --- The command ------------------------------------------------------------------------------

const cli = async (args: ReadonlyArray<string>, cwd: string) => {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")))
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")))
  const before = process.cwd()
  process.chdir(cwd)
  process.exitCode = undefined
  try {
    await runWith(args).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          recordingSpawner([]),
          PromptIOLive,
          Layer.succeed(DoctorProbe, healthy),
        ),
      ),
      Effect.runPromise,
    )
  } finally {
    process.chdir(before)
    vi.restoreAllMocks()
  }
  const exitCode = process.exitCode ?? 0
  process.exitCode = undefined
  return { stdout: out.join("\n"), stderr: err.join("\n"), exitCode }
}

it("doctor --json: one document, ok: true, exit code 2 when a check fails", async () => {
  const dir = await project()
  const r = await cli(["doctor", "--json"], dir)
  expect(r.stderr).toBe("")
  const doc = JSON.parse(r.stdout)
  expect(doc).toMatchObject({ ok: true, status: "fail", directory: dir })
  expect(r.exitCode).toBe(2)
})

it("doctor outside a project is NotAnEfforgeProject, pointing --cwd at the one beside it", async () => {
  const dir = await project()
  const r = await cli(["doctor", "--json"], join(dir, "apps/web"))
  const doc = JSON.parse(r.stdout)
  expect(doc.error).toMatchObject({
    code: "NotAnEfforgeProject",
    fix: "npx -y create-efforge doctor --json --cwd=../..",
  })
  expect(r.exitCode).toBe(1)
})

it("doctor text: one line per check, a Try: line under each problem", async () => {
  const dir = await project()
  const r = await cli(["doctor"], dir)
  // with CI set, picocolors colours the marks even in a pipe: read the text without the codes
  const text = stripVTControlCharacters(r.stdout)
  const lines = text.split("\n")
  expect(lines.filter((l) => /^[✓!✗-] /.test(l))).toHaveLength(checks.length)
  expect(text).toContain("Try: pnpm install --no-frozen-lockfile")
  expect(text).toMatch(/1 failed, 1 warning, \d+ ok, \d+ skipped\.$/)
})
