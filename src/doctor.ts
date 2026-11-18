import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { Context, Effect, type FileSystem, type Path } from "effect"
import { type ParseError, parse } from "jsonc-parser"
import { parseAllDocuments } from "yaml"
import { addonIdsFor, type AddonManifest, type LoadedAddon } from "./addon.ts"
import { presentCardTransforms } from "./cards.ts"
import { BIN, inDir, quote } from "./contract.ts"
import { localEnvFile } from "./commands/create.ts"
import { INSTALL } from "./exec.ts"
import { matches } from "./generate.ts"
import { installOwed } from "./installed.ts"
import type { EfforgeManifest } from "./manifest.ts"
import { compareVersions, satisfies } from "./semver.ts"
import type { StackConfig } from "./stack.ts"
import type { TransformCall } from "./transforms/index.ts"
import { checkUpgrade, missingOverrides, pinnedPnpm, readWorkspace } from "./upgrade.ts"
import {
  effectOverrides,
  efforgeVersion,
  isEffectLockstep,
  pnpmVersion,
  pnpmWildcardOverrides,
} from "./versions.ts"

// `doctor`: what is wrong with this checkout right now, each finding with why and what fixes it.
// It reads files, runs `pnpm --version` and `pnpm peers check`, and opens a TCP connection to a
// local Postgres; it writes nothing and needs no network unless asked (`--online`).
//
// Each check is a small named unit (`checks` below). Most of what a check looks for comes from the
// add-ons' manifests, so an add-on contributes to `env`, `bindings` and `layers` by declaring its
// env vars and transforms; a check of its own is a new entry here (docs/decisions/0009).

export type CheckStatus = "ok" | "warn" | "fail" | "skipped"

export interface CheckResult {
  readonly id: string
  readonly status: CheckStatus
  /** One or two sentences: what was found and why it matters. */
  readonly message: string
  /** A shell command that fixes it, or null (then `details` says what to change). */
  readonly fix: string | null
  readonly details?: Readonly<Record<string, unknown>>
}

/** The checks' view of the outside world, replaceable in tests. */
export interface Probe {
  readonly nodeVersion: () => string
  /** The pnpm on PATH, run outside the project so `packageManager` doesn't switch it. */
  readonly pnpmVersion: () => string | undefined
  /** `pnpm peers check --json` in `dir`; undefined when it couldn't run. */
  readonly peers: (dir: string) => string | undefined
  readonly reachable: (host: string, port: number) => Effect.Effect<boolean>
  /** The names in the `d1_migrations` table of each local D1 database file. */
  readonly appliedD1: (files: ReadonlyArray<string>) => string[] | undefined
}

const spawnText = (cmd: string, args: string[], cwd: string, timeout: number) => {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout,
    env: { ...process.env, CI: "1" },
  })
  return r.error !== undefined || r.status === null
    ? undefined
    : { status: r.status, stdout: r.stdout }
}

export const liveProbe: Probe = {
  nodeVersion: () => process.versions.node,
  pnpmVersion: () => {
    const r = spawnText("pnpm", ["--version"], tmpdir(), 30_000)
    const v = r?.status === 0 ? r.stdout.trim() : ""
    return /^\d+\.\d+\.\d+/.test(v) ? v : undefined
  },
  peers: (dir) => spawnText("pnpm", ["peers", "check", "--json"], dir, 120_000)?.stdout,
  reachable: (host, port) =>
    Effect.callback<boolean>((resume) => {
      const socket = createConnection({ host, port })
      const done = (ok: boolean) => {
        socket.destroy()
        resume(Effect.succeed(ok))
      }
      socket.setTimeout(1500, () => done(false))
      socket.once("connect", () => done(true))
      socket.once("error", () => done(false))
    }),
  appliedD1: (files) => {
    // node:sqlite prints an ExperimentalWarning on some Node versions; --json allows no stderr
    const original = Object.getOwnPropertyDescriptor(process, "emitWarning")
    try {
      Object.defineProperty(process, "emitWarning", {
        value: () => {},
        configurable: true,
        writable: true,
      })
      const { DatabaseSync } = process.getBuiltinModule("node:sqlite")
      const names: string[] = []
      for (const file of files) {
        const db = new DatabaseSync(file, { readOnly: true })
        try {
          const table = db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'",
            )
            .get()
          if (table !== undefined)
            for (const row of db.prepare("SELECT name FROM d1_migrations").all())
              names.push(String((row as { name: unknown }).name))
        } finally {
          db.close()
        }
      }
      return names
    } catch {
      return undefined
    } finally {
      if (original !== undefined) Object.defineProperty(process, "emitWarning", original)
    }
  },
}

export const DoctorProbe = Context.Reference<Probe>("efforge/DoctorProbe", {
  defaultValue: () => liveProbe,
})

/** Everything a check may read. */
export interface DoctorContext {
  readonly dir: string
  /** The manifest, or undefined when efforge.jsonc isn't valid (see `manifestProblem`). */
  readonly manifest: EfforgeManifest | undefined
  readonly manifestProblem: string | undefined
  /** The add-ons of the project's stack, in generate order. */
  readonly addons: ReadonlyArray<LoadedAddon>
  readonly all: ReadonlyMap<string, LoadedAddon>
  readonly online: boolean
  readonly probe: Probe
  /** `engines.node` of the projects this efforge generates. */
  readonly engines: string
  /** A file of the project, or undefined. */
  readonly read: (rel: string) => string | undefined
  /** `cmd` run from where efforge was run: `cd <project> && cmd` when that is elsewhere. */
  readonly here: (...commands: string[]) => string
  /** An efforge command for this project, with --cwd when efforge was run elsewhere. */
  readonly efforge: (args: string) => string
}

export interface Check {
  readonly id: string
  /** What it looks at, for people. */
  readonly title: string
  readonly run: (
    ctx: DoctorContext,
  ) => Effect.Effect<Omit<CheckResult, "id">, never, FileSystem.FileSystem | Path.Path>
}

const ok = (message: string, details?: Record<string, unknown>) => ({
  status: "ok" as const,
  message,
  fix: null,
  ...(details === undefined ? {} : { details }),
})
const skipped = (message: string) => ({ status: "skipped" as const, message, fix: null })

const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const json = (text: string | undefined): Record<string, unknown> | undefined => {
  if (text === undefined) return undefined
  try {
    return record(JSON.parse(text))
  } catch {
    return undefined
  }
}

const jsonc = (text: string | undefined): Record<string, unknown> | undefined => {
  if (text === undefined) return undefined
  const errors: ParseError[] = []
  const v = parse(text, errors, { allowTrailingComma: true }) as unknown
  return errors.length > 0 ? undefined : record(v)
}

/** Transforms of the stack's add-ons that apply to it (cards included where the files are). */
const transformsOf = (ctx: DoctorContext, stack: StackConfig, name: string) =>
  ctx.addons.flatMap(({ manifest }) =>
    [...manifest.transforms, ...presentCardTransforms(manifest, (f) => ctx.read(f) !== undefined)]
      .filter((t) => t.name === name && matches((t as { when?: never }).when, stack))
      .map((t): { addon: AddonManifest; t: TransformCall } => ({ addon: manifest, t })),
  )

// --- Toolchain ----------------------------------------------------------------------------------

const nodeCheck: Check = {
  id: "node",
  title: "Node version",
  run: (ctx) =>
    Effect.sync(() => {
      const version = ctx.probe.nodeVersion()
      const declared = json(ctx.read("package.json"))?.engines
      const own =
        typeof record(declared).node === "string" ? (record(declared).node as string) : undefined
      const range = own ?? ctx.engines
      const where = own === undefined ? `efforge's projects need` : `package.json engines asks for`
      return satisfies(version, range)
        ? ok(`Node ${version}; ${where} ${range}.`)
        : {
            status: "fail" as const,
            message: `Node ${version} is too old or unsupported: ${where} ${range}. The build tools (Vite+, wrangler) fail in odd ways on other versions.`,
            fix: null,
            details: { version, range },
          }
    }),
}

const pnpmCheck: Check = {
  id: "pnpm",
  title: "pnpm version",
  run: (ctx) =>
    Effect.sync(() => {
      const global = ctx.probe.pnpmVersion()
      const pin = pinnedPnpm(json(ctx.read("package.json"))?.packageManager)
      if (global === undefined)
        return {
          status: "fail" as const,
          message: "pnpm isn't on your PATH, and efforge projects use it.",
          fix: "npm install --global pnpm",
        }
      if (pin === undefined)
        return {
          status: "warn" as const,
          message: `pnpm ${global}; package.json has no packageManager, so every machine installs with whatever pnpm it has. efforge pins pnpm@${pnpmVersion}.`,
          fix: ctx.here(`npm pkg set packageManager=pnpm@${pnpmVersion}`),
          details: { pnpm: global },
        }
      if (compareVersions(pin, pnpmWildcardOverrides) < 0)
        return {
          status: "fail" as const,
          message: `packageManager pins pnpm ${pin}, which ignores the overrides that keep Effect's packages on one version (they work from pnpm ${pnpmWildcardOverrides}).`,
          fix: ctx.here(`npm pkg set packageManager=pnpm@${pnpmVersion}`, INSTALL),
          details: { pnpm: global, packageManager: pin },
        }
      return ok(
        global === pin
          ? `pnpm ${global}, as packageManager pins.`
          : `pnpm ${global} on your PATH; it switches to ${pin} (packageManager) in this project.`,
        { pnpm: global, packageManager: pin },
      )
    }),
}

// --- The project file ---------------------------------------------------------------------------

const manifestCheck: Check = {
  id: "manifest",
  title: "efforge.jsonc",
  run: (ctx) =>
    Effect.sync(() =>
      ctx.manifestProblem === undefined
        ? ok(`efforge.jsonc is valid: made with efforge ${ctx.manifest?.efforgeVersion}.`)
        : {
            status: "fail" as const,
            message: `${ctx.manifestProblem}. efforge reads the stack from it, so add, upgrade and most of these checks can't run.`,
            fix: null,
            details: { problem: ctx.manifestProblem },
          },
    ),
}

// --- Installed dependencies ---------------------------------------------------------------------

const installCheck: Check = {
  id: "install",
  title: "Dependencies installed",
  run: (ctx) =>
    Effect.sync(() => {
      if (!existsSync(join(ctx.dir, "node_modules", ".modules.yaml")))
        return {
          status: "fail" as const,
          message: "Dependencies aren't installed (no node_modules).",
          fix: ctx.here(INSTALL),
        }
      if (installOwed(ctx.dir))
        return {
          status: "fail" as const,
          message:
            "node_modules doesn't match the package.json files and pnpm-workspace.yaml: something changed them after the last install, or an install didn't finish.",
          fix: ctx.here(INSTALL),
        }
      if (ctx.read("pnpm-lock.yaml") === undefined)
        return {
          status: "warn" as const,
          message: "There is no pnpm-lock.yaml, so each install can resolve different versions.",
          fix: ctx.here(INSTALL),
        }
      return ok("node_modules matches the package.json files and pnpm-workspace.yaml.")
    }),
}

/** `name@version` -> [name, version], for keys of a pnpm lockfile's `packages`/`snapshots`. */
const splitKey = (key: string): [string, string] | undefined => {
  const bare = key.replace(/\(.*$/, "")
  const at = bare.lastIndexOf("@")
  return at <= 0 ? undefined : [bare.slice(0, at), bare.slice(at + 1)]
}

/** Every `name@version` pnpm resolved, from the installed lockfile or else pnpm-lock.yaml. */
const resolved = (
  ctx: DoctorContext,
): { file: string; packages: Array<[string, string]> } | undefined => {
  for (const file of ["node_modules/.pnpm/lock.yaml", "pnpm-lock.yaml"]) {
    const text = ctx.read(file)
    if (text === undefined) continue
    try {
      const keys = parseAllDocuments(text).flatMap((doc) => {
        const v = record(doc.toJS())
        return Object.keys(record(v.packages)).concat(Object.keys(record(v.snapshots)))
      })
      const seen = new Set<string>()
      const packages: Array<[string, string]> = []
      for (const key of keys) {
        const p = splitKey(key)
        if (p === undefined || seen.has(p.join("@"))) continue
        seen.add(p.join("@"))
        packages.push(p)
      }
      return { file, packages }
    } catch {}
  }
  return undefined
}

const effectCheck: Check = {
  id: "effect",
  title: "One Effect version",
  run: (ctx) =>
    Effect.sync(() => {
      const catalog = readWorkspace(ctx.dir).catalog.effect
      const lock = resolved(ctx)
      if (lock === undefined) return skipped("Nothing is installed or locked yet.")
      const effect4 = [
        ...new Set(
          lock.packages
            .filter(([n, v]) => n === "effect" && Number(v.split(".")[0]) >= 4)
            .map(([, v]) => v),
        ),
      ].toSorted(compareVersions)
      const pin = catalog ?? effect4[0]
      if (pin === undefined) return skipped("This project doesn't use Effect 4.")
      const off = lock.packages
        .filter(
          ([n, v]) => isEffectLockstep(n) && v !== pin && !(n === "effect" && !v.startsWith("4")),
        )
        .map(([n, v]) => `${n} ${v}`)
      if (off.length === 0)
        return ok(`Every Effect package resolved to ${pin} (${lock.file}).`, { effect: pin })
      const guard = missingOverrides(readWorkspace(ctx.dir).overrides, pin).length === 0
      return {
        status: "fail" as const,
        message: `effect is ${pin}, but ${off.join(", ")} resolved to another version: two Effects in one build, which fails (Effect's packages only work at one shared version). ${guard ? "The overrides are in place, so a fresh install fixes it." : "pnpm-workspace.yaml lacks the overrides that prevent it; upgrade --check prints the lines."}`,
        fix: guard ? ctx.here(INSTALL) : ctx.efforge("upgrade --check"),
        details: { effect: pin, others: off, lockfile: lock.file },
      }
    }),
}

const guardCheck: Check = {
  id: "effect-guard",
  title: "Effect overrides",
  run: (ctx) =>
    Effect.sync(() => {
      const { catalog, overrides } = readWorkspace(ctx.dir)
      const effect = catalog.effect
      if (effect === undefined) return skipped("The catalog has no effect pin.")
      const missing = missingOverrides(overrides, effect)
      return missing.length === 0
        ? ok(`pnpm-workspace.yaml holds every Effect package at ${effect}.`)
        : {
            status: "warn" as const,
            message: `pnpm-workspace.yaml ${missing.length === Object.keys(effectOverrides(effect)).length ? "has no overrides holding Effect's packages" : `doesn't hold every Effect package (${missing.join(", ")})`} at ${effect}, so the next install can put a newer one next to it and break the build. upgrade --check prints the lines to add; efforge add writes them too.`,
            fix: ctx.efforge("upgrade --check"),
            details: { missing },
          }
    }),
}

/**
 * Unmet peers inside third-party packages that efforge can't fix from a template. Upstream as of
 * 2026-11-18: @alchemy.run/cloudflare-runtime depends on `unenv: ^2.0.0-rc.24` (now rc.25) and on
 * @cloudflare/unenv-preset, which peers on exactly 2.0.0-rc.24. The stack still passes its gate.
 */
export const knownUpstreamPeer = (peer: string, parents: ReadonlyArray<{ name: string }>) =>
  peer === "unenv" &&
  parents.some((p) => p.name === "@alchemy.run/cloudflare-runtime") &&
  parents.at(-1)?.name === "@cloudflare/unenv-preset"

interface PeerIssue {
  readonly optional: boolean
  readonly wantedRange?: string
  readonly foundVersion?: string
  readonly parents: ReadonlyArray<{ readonly name: string }>
}

/**
 * `pnpm peers check --json`, sorted: `unmet` fail the check; `known` are the upstream ones above,
 * and optional peers outside their range (alchemy's capnp-es asks for typescript 5 or 6), which
 * don't. An optional Effect peer out of range is unmet: that is two Effects.
 */
export const classifyPeers = (report: unknown): { unmet: string[]; known: string[] } => {
  const unmet: string[] = []
  const known: string[] = []
  for (const [project, r] of Object.entries(record(report))) {
    const groups = [
      ...Object.entries(record(record(r).bad)),
      ...Object.entries(record(record(r).missing)),
    ]
    for (const [peer, issues] of groups)
      for (const i of (Array.isArray(issues) ? issues : []) as PeerIssue[]) {
        const line = `${project}: ${peer} ${i.foundVersion ?? "missing"}, wanted ${i.wantedRange ?? "?"}${i.parents.length > 0 ? ` by ${i.parents.at(-1)?.name}` : ""}`
        if (knownUpstreamPeer(peer, i.parents) || (i.optional && !isEffectLockstep(peer)))
          known.push(line)
        else unmet.push(line)
      }
  }
  return { unmet, known }
}

const peersCheck: Check = {
  id: "peers",
  title: "Peer dependencies",
  run: (ctx) =>
    Effect.sync(() => {
      if (!existsSync(join(ctx.dir, "node_modules", ".modules.yaml")))
        return skipped("Nothing is installed yet.")
      const pin = pinnedPnpm(json(ctx.read("package.json"))?.packageManager)
      const global = ctx.probe.pnpmVersion()
      // in the project pnpm switches to the pinned version, which it may have to download
      if (!ctx.online && pin !== undefined && global !== undefined && pin !== global)
        return skipped(
          `pnpm here is ${pin} (packageManager) and ${global} on your PATH; running it may download ${pin}. Run doctor --online to check peers anyway.`,
        )
      const out = ctx.probe.peers(ctx.dir)
      let report: unknown
      try {
        report = out === undefined ? undefined : JSON.parse(out)
      } catch {}
      if (report === undefined) return skipped("pnpm peers check didn't run or printed no report.")
      const { unmet, known } = classifyPeers(report)
      if (unmet.length > 0)
        return {
          status: "fail" as const,
          message: `${unmet.length} unmet peer ${unmet.length === 1 ? "dependency" : "dependencies"}: ${unmet.slice(0, 3).join("; ")}${unmet.length > 3 ? "; ..." : ""}.`,
          fix: null,
          details: { unmet, known },
        }
      return ok(
        known.length === 0
          ? "No unmet peer dependencies."
          : `No unmet peer dependencies of yours; ${known.length} known upstream (Alchemy's unenv, optional peers), which don't affect the build.`,
        { unmet, known },
      )
    }),
}

// --- Environment --------------------------------------------------------------------------------

/** `NAME=value` lines of a .dev.vars or .env file. */
const envValues = (text: string | undefined): Map<string, string> => {
  const out = new Map<string, string>()
  for (const line of (text ?? "").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line)
    if (m === null) continue
    out.set(m[1] as string, (m[2] as string).trim().replace(/^(['"])(.*)\1$/, "$2"))
  }
  return out
}

const sourceFiles = (dir: string, roots: ReadonlyArray<string>): string[] => {
  const out: string[] = []
  const walk = (rel: string) => {
    let entries
    try {
      entries = readdirSync(join(dir, rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue
      const child = `${rel}/${e.name}`
      if (e.isDirectory()) walk(child)
      else if (/\.tsx?$/.test(e.name) && !/\.(test|gen)\.tsx?$/.test(e.name)) out.push(child)
    }
  }
  for (const r of roots) walk(r)
  return out
}

/** Every `Config.X("NAME")` the app's code reads, and whether it has a default or is optional. */
export const configReads = (text: string): Array<{ name: string; required: boolean }> => {
  const out: Array<{ name: string; required: boolean }> = []
  for (const m of text.matchAll(
    /Config\.(?:String|Redacted|Number|Integer|Boolean|Url|Port|NonEmptyString)\(\s*"([A-Z][A-Z0-9_]*)"\s*\)/g,
  )) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 20), m.index)
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 80)
    const optional =
      /Config\.option\(\s*$/.test(before) ||
      /^\s*(?:\.pipe\(\s*|,\s*)Config\.(?:withDefault|option)/.test(after)
    out.push({ name: m[1] as string, required: !optional })
  }
  return out
}

const PLACEHOLDER =
  /change-me|replace-me|your-|example\.(?:com|org)|^sk-\.\.\.$|^openssl rand|^<.*>$/i

export interface EnvFinding {
  readonly name: string
  readonly required: boolean
  readonly status: "ok" | "missing" | "empty" | "placeholder" | "undocumented"
}

const envCheck: Check = {
  id: "env",
  title: "Environment variables",
  run: (ctx) =>
    Effect.sync(() => {
      const stack = ctx.manifest?.stack
      if (stack === undefined) return skipped("efforge.jsonc isn't valid, so the stack is unknown.")
      const file = localEnvFile(stack)
      const local = ctx.read(file)
      const values = envValues(local)
      const example = envValues(ctx.read(".env.example"))
      const vars = jsonc(ctx.read("wrangler.jsonc"))?.vars
      const inWrangler = new Set(Object.keys(record(vars)))
      // what the add-ons declare, what efforge writes for local development, what the code reads
      const declared = new Map<string, { example: string }>()
      for (const { manifest } of ctx.addons)
        for (const v of manifest.envVars)
          if (matches(v.when, stack) && !declared.has(v.name))
            declared.set(v.name, { example: v.example })
      const devValues = new Map(
        transformsOf(ctx, stack, "addDevVar").map(({ t }) => [
          t.args.name as string,
          t.args.value as string,
        ]),
      )
      const required = new Map<string, boolean>()
      const roots = ["apps", "packages", ...(stack.infra === "alchemy" ? ["infra"] : [])]
      for (const f of sourceFiles(ctx.dir, roots)) {
        if (!f.includes("/src/") && !f.startsWith("infra/")) continue
        for (const r of configReads(ctx.read(f) ?? ""))
          required.set(r.name, (required.get(r.name) ?? false) || r.required)
      }
      const names = [
        ...new Set([...declared.keys(), ...devValues.keys(), ...required.keys()]),
      ].toSorted()
      const findings: EnvFinding[] = names.map((name) => {
        const req = required.get(name) ?? false
        const value =
          values.get(name) ?? (inWrangler.has(name) ? "(wrangler.jsonc vars)" : undefined)
        const status: EnvFinding["status"] =
          value === undefined
            ? "missing"
            : value === ""
              ? "empty"
              : value !== devValues.get(name) && PLACEHOLDER.test(value)
                ? "placeholder"
                : !example.has(name)
                  ? "undocumented"
                  : "ok"
        return { name, required: req, status }
      })
      const bad = findings.filter(
        (f) => f.required && (f.status === "missing" || f.status === "empty"),
      )
      const soft = findings.filter((f) => f.status === "placeholder" || f.status === "undocumented")
      const describe = (fs: ReadonlyArray<EnvFinding>) =>
        fs
          .map(
            (f) => `${f.name} (${f.status === "undocumented" ? "not in .env.example" : f.status})`,
          )
          .join(", ")
      const details = { file, vars: findings }
      if (bad.length > 0) {
        const lines = bad.flatMap((f) => {
          const v = devValues.get(f.name)
          return v === undefined || values.has(f.name) ? [] : [`${f.name}=${v}`]
        })
        return {
          status: "fail" as const,
          message: `${local === undefined ? `There is no ${file}, so the` : "The"} app reads ${bad.length === 1 ? "a setting" : "settings"} that ${file} doesn't set: ${describe(bad)}. ${bad.length === 1 ? "It fails" : "They fail"} at startup with a "not configured" page. See .env.example for what each is.${soft.length > 0 ? ` Also: ${describe(soft)}.` : ""}`,
          // with Alchemy, create's next step is to copy the example; without, efforge's local values
          fix:
            local === undefined && file === ".env" && ctx.read(".env.example") !== undefined
              ? ctx.here("cp .env.example .env")
              : lines.length === bad.length
                ? ctx.here(`printf '%s\\n' ${lines.map(quote).join(" ")} >> ${file}`)
                : null,
          details,
        }
      }
      if (soft.length > 0)
        return {
          status: "warn" as const,
          message: `${describe(soft)}. A placeholder works until the feature that reads it is used; set real values before you deploy (wrangler secret put NAME, or your deploy workflow's secrets).`,
          fix: null,
          details,
        }
      return ok(
        names.length === 0
          ? "This stack reads no env vars."
          : `${names.length} env ${names.length === 1 ? "var" : "vars"} set in ${file} or documented as optional.`,
        details,
      )
    }),
}

// --- Bindings -----------------------------------------------------------------------------------

const isEntry = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const sameBinding = (a: Record<string, unknown>, b: unknown): boolean => {
  if (!isEntry(b)) return false
  if (a.binding !== undefined) return a.binding === b.binding
  if (a.name !== undefined) return a.name === b.name
  if (a.tag !== undefined) return a.tag === b.tag
  if (a.class_name !== undefined) return a.class_name === b.class_name
  return JSON.stringify(a) === JSON.stringify(b)
}

const label = (key: string, entry: Record<string, unknown>) => {
  const id = [entry.binding, entry.name, entry.tag, entry.class_name].find(
    (x): x is string => typeof x === "string",
  )
  return `${key} ${id ?? JSON.stringify(entry)}`
}

const bindingsCheck: Check = {
  id: "bindings",
  title: "Cloudflare bindings",
  run: (ctx) =>
    Effect.sync(() => {
      const stack = ctx.manifest?.stack
      if (stack === undefined) return skipped("efforge.jsonc isn't valid, so the stack is unknown.")
      if (stack.infra === "alchemy") {
        const file = "infra/alchemy.run.ts"
        const text = ctx.read(file)
        const wanted = transformsOf(ctx, stack, "addAlchemyResource").filter(
          ({ t }) => t.args.binding !== undefined || t.args.name !== undefined,
        )
        if (text === undefined)
          return wanted.length === 0
            ? skipped(`There is no ${file}.`)
            : {
                status: "fail" as const,
                message: `${file} is missing, and it declares the Worker and its bindings.`,
                fix: null,
              }
        const flat = text.replace(/\s+/g, " ")
        const lacking = wanted.filter(({ t }) => {
          const name = t.args.name as string
          const binding = t.args.binding ?? name
          const entry =
            binding === name
              ? new RegExp(`[{,]\\s*${name}\\s*[,}]`)
              : new RegExp(`\\b${binding}\\s*:\\s*${name}\\b`)
          return !flat.includes(`const ${name} =`) || !entry.test(flat)
        })
        if (lacking.length > 0)
          return {
            status: "fail" as const,
            message: `${file} lacks ${lacking.map(({ t, addon }) => `${t.args.binding ?? t.args.name} (${addon.id})`).join(", ")}. The Worker reads ${lacking.length === 1 ? "it" : "them"} from its env, so the feature fails at runtime.`,
            fix: null,
            details: {
              file,
              missing: lacking.map(({ t }) => ({
                binding: t.args.binding ?? t.args.name,
                code: t.args.code,
              })),
            },
          }
        return ok(
          wanted.length === 0
            ? "This stack needs no bindings."
            : `${file} declares the ${wanted.length} resources this stack needs.`,
        )
      }
      const file = "wrangler.jsonc"
      const wanted = transformsOf(ctx, stack, "addWranglerBinding").flatMap(({ t, addon }) => {
        const v = JSON.parse(t.args.value as string) as unknown
        return (Array.isArray(v) ? v : [v])
          .filter(isEntry)
          .map((entry) => ({ key: t.args.key as string, entry, addon: addon.id }))
      })
      const text = ctx.read(file)
      if (text === undefined)
        return {
          status: "fail" as const,
          message: `${file} is missing: wrangler and the Vite plugin read the Worker's config from it.`,
          fix: null,
        }
      const doc = jsonc(text)
      if (doc === undefined)
        return { status: "fail" as const, message: `${file} isn't valid JSONC.`, fix: null }
      const lacking = wanted.filter(({ key, entry }) => {
        let cur: unknown = doc
        for (const part of key.split(".")) cur = record(cur)[part]
        return !(Array.isArray(cur) && cur.some((e) => sameBinding(entry, e)))
      })
      if (lacking.length > 0)
        return {
          status: "fail" as const,
          message: `${file} lacks ${lacking.map(({ key, entry, addon }) => `${label(key, entry)} (${addon})`).join(", ")}. The code reads ${lacking.length === 1 ? "it" : "them"} from the Worker env, so the feature fails at runtime.`,
          fix: null,
          details: {
            file,
            missing: lacking.map(({ key, entry }) => ({ key, value: entry })),
          },
        }
      return ok(
        wanted.length === 0
          ? "This stack needs no bindings."
          : `${file} has the ${wanted.length} ${wanted.length === 1 ? "binding" : "bindings"} this stack needs (${wanted.map(({ key, entry }) => label(key, entry)).join(", ")}).`,
      )
    }),
}

// --- Database -----------------------------------------------------------------------------------

const D1_STATE = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject"

const migrationsCheck: Check = {
  id: "migrations",
  title: "Local migrations",
  run: (ctx) =>
    Effect.sync(() => {
      const stack = ctx.manifest?.stack
      if (stack === undefined) return skipped("efforge.jsonc isn't valid, so the stack is unknown.")
      if (stack.database === "none") return skipped("This stack has no database.")
      if (stack.database === "postgres")
        return skipped(
          "Which Postgres migrations are applied can't be read without connecting to the database.",
        )
      if (stack.infra === "alchemy")
        return skipped("Alchemy applies D1 migrations when it runs (pnpm dev).")
      // drizzle-kit writes one folder per migration; `pnpm db:migrate` numbers them like this
      const dirOf = (rel: string) => {
        try {
          return readdirSync(join(ctx.dir, rel), { withFileTypes: true })
        } catch {
          return undefined
        }
      }
      const drizzle = dirOf("packages/db/drizzle")
      const expected =
        stack.orm === "drizzle" && drizzle !== undefined
          ? drizzle
              .filter(
                (e) =>
                  e.isDirectory() &&
                  existsSync(join(ctx.dir, "packages/db/drizzle", e.name, "migration.sql")),
              )
              .map((e) => e.name)
              .toSorted()
              .map((d, i) => `${String(i + 1).padStart(4, "0")}_${d.replace(/^\d+_/, "")}.sql`)
          : (dirOf("packages/db/migrations") ?? [])
              .filter((e) => e.isFile() && e.name.endsWith(".sql"))
              .map((e) => e.name)
              .toSorted()
      if (expected.length === 0) return skipped("There are no migration files.")
      const state = dirOf(D1_STATE)
      const files = (state ?? [])
        .filter((e) => e.isFile() && e.name.endsWith(".sqlite") && e.name !== "metadata.sqlite")
        .map((e) => join(ctx.dir, D1_STATE, e.name))
      const applied = files.length === 0 ? [] : ctx.probe.appliedD1(files)
      if (applied === undefined) return skipped("The local D1 database couldn't be read.")
      const pending = expected.filter((m) => !applied.includes(m))
      if (pending.length === 0)
        return ok(`All ${expected.length} migrations are applied to the local D1 database.`)
      return {
        status: "warn" as const,
        message: `${pending.length} of ${expected.length} migrations ${pending.length === 1 ? "isn't" : "aren't"} applied to the local D1 database (${pending.join(", ")}), so pnpm dev runs against missing tables.`,
        fix: ctx.here("pnpm db:migrate"),
        details: { pending, applied },
      }
    }),
}

const postgresCheck: Check = {
  id: "postgres",
  title: "Local Postgres",
  run: (ctx) =>
    Effect.gen(function* () {
      const stack = ctx.manifest?.stack
      if (stack === undefined) return skipped("efforge.jsonc isn't valid, so the stack is unknown.")
      if (stack.database !== "postgres") return skipped("This stack doesn't use Postgres.")
      const env = envValues(ctx.read(localEnvFile(stack)))
      const hyperdrive = record(jsonc(ctx.read("wrangler.jsonc"))).hyperdrive
      const fromWrangler = Array.isArray(hyperdrive)
        ? hyperdrive
            .map((h) => record(h).localConnectionString)
            .find((x): x is string => typeof x === "string")
        : undefined
      const url =
        process.env.DATABASE_URL ||
        env.get("DATABASE_URL") ||
        fromWrangler ||
        "postgres://postgres:postgres@localhost:5432/app"
      let host: string
      let port: number
      try {
        const u = new URL(url)
        host = u.hostname.replace(/^\[|\]$/g, "")
        port = Number(u.port || 5432)
      } catch {
        return { status: "warn" as const, message: "DATABASE_URL isn't a URL.", fix: null }
      }
      if (!["localhost", "127.0.0.1", "::1"].includes(host) && !ctx.online)
        return skipped(
          `The database is on ${host}, not this machine; run doctor --online to try it.`,
        )
      const up = yield* ctx.probe.reachable(host, port)
      return up
        ? ok(`Postgres answers on ${host}:${port}.`)
        : {
            status: "warn" as const,
            message: `Nothing answers on ${host}:${port}, so pnpm dev and pnpm db:migrate can't reach the database. The build doesn't need it.`,
            fix: ctx.here("docker compose up -d --wait"),
            details: { host, port },
          }
    }),
}

// --- Composition --------------------------------------------------------------------------------

const LAYERS = "apps/web/src/server/layers.ts"

const layersCheck: Check = {
  id: "layers",
  title: "Layers in layers.ts",
  run: (ctx) =>
    Effect.sync(() => {
      const stack = ctx.manifest?.stack
      if (stack === undefined) return skipped("efforge.jsonc isn't valid, so the stack is unknown.")
      const wanted = transformsOf(ctx, stack, "addLayer").filter(({ t }) => t.args.file === LAYERS)
      const text = ctx.read(LAYERS)
      if (text === undefined)
        return {
          status: "fail" as const,
          message: `${LAYERS} is missing: it composes the app's layers.`,
          fix: null,
        }
      // inside `AppLayer = Layer.mergeAll(...)`, not the imports above it
      const flat = text.replace(/\s+/g, "")
      const at = flat.indexOf("AppLayer=Layer.mergeAll(")
      const call = at < 0 ? "" : flat.slice(at)
      const lacking = wanted.filter(
        ({ t }) => !call.includes((t.args.layer as string).replace(/\s+/g, "")),
      )
      if (lacking.length > 0)
        return {
          status: "fail" as const,
          message: `AppLayer in ${LAYERS} lacks ${lacking.map(({ t, addon }) => `${t.args.layer} (${addon.id})`).join(", ")}, so the services ${lacking.length === 1 ? "it provides fail" : "they provide fail"} at runtime with a missing service.`,
          fix: null,
          details: {
            file: LAYERS,
            missing: lacking.map(({ t }) => ({
              layer: t.args.layer,
              import: t.args.import,
              from: t.args.from,
            })),
          },
        }
      return ok(
        wanted.length === 0
          ? "No add-on of this stack adds a layer."
          : `AppLayer has a layer for each add-on (${wanted.map(({ addon }) => addon.id).join(", ")}).`,
      )
    }),
}

const upgradeCheck: Check = {
  id: "upgrade",
  title: "Compared with this efforge",
  run: (ctx) =>
    Effect.gen(function* () {
      const manifest = ctx.manifest
      if (manifest === undefined) return skipped("efforge.jsonc isn't valid.")
      const report = yield* checkUpgrade(ctx.dir, manifest, ctx.all, { diff: false }).pipe(
        Effect.map((r) => r as typeof r | undefined),
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (report === undefined)
        return skipped(`Couldn't render efforge ${efforgeVersion}'s templates for this stack.`)
      const made = `Made with efforge ${manifest.efforgeVersion}`
      if (!report.drifted)
        return ok(
          `${made}; nothing to do to match efforge ${efforgeVersion}${report.project.status === "ahead" ? " (the project is newer than this CLI)" : ""}.`,
        )
      return {
        status: "warn" as const,
        message: `${made}; it differs from what efforge ${efforgeVersion} generates (${[
          report.guards.some((g) => !g.ok) ? "Effect guard" : undefined,
          report.pins.some((p) => p.status === "behind")
            ? `${report.pins.filter((p) => p.status === "behind").length} pins behind`
            : undefined,
          report.files.some((f) => f.status === "refresh") ? "files to refresh" : undefined,
          report.seams.length > 0 ? "missing seams" : undefined,
        ]
          .filter((x) => x !== undefined)
          .join(", ")}). upgrade --check says what to do.`,
        fix: ctx.efforge("upgrade --check"),
      }
    }),
}

/** Every check, in the order they print. An add-on's own check goes here, after what it needs. */
export const checks: ReadonlyArray<Check> = [
  nodeCheck,
  pnpmCheck,
  manifestCheck,
  installCheck,
  effectCheck,
  guardCheck,
  peersCheck,
  envCheck,
  bindingsCheck,
  migrationsCheck,
  postgresCheck,
  layersCheck,
  upgradeCheck,
]

/** Runs every check; a check that throws is reported as failed, not as a crash of the rest. */
export const runChecks = (ctx: DoctorContext, list: ReadonlyArray<Check> = checks) =>
  Effect.forEach(list, (c) =>
    c.run(ctx).pipe(
      Effect.catchDefect((e) =>
        Effect.succeed({
          status: "fail" as const,
          message: `The check itself failed: ${String(e)}. This is a bug in efforge.`,
          fix: null,
        }),
      ),
      Effect.map((r): CheckResult => Object.assign({ id: c.id }, r)),
    ),
  )

/** The worst status of `results`: fail, then warn, then ok. */
export const overall = (results: ReadonlyArray<CheckResult>): "ok" | "warn" | "fail" =>
  results.some((r) => r.status === "fail")
    ? "fail"
    : results.some((r) => r.status === "warn")
      ? "warn"
      : "ok"

/** Builds the context for `dir`. */
export const doctorContext = (opts: {
  readonly dir: string
  readonly manifest: EfforgeManifest | undefined
  readonly manifestProblem: string | undefined
  readonly all: ReadonlyMap<string, LoadedAddon>
  readonly online: boolean
  readonly probe: Probe
  readonly engines: string
}): DoctorContext => {
  const rel = relative(process.cwd(), opts.dir)
  return {
    ...opts,
    addons:
      opts.manifest === undefined
        ? []
        : addonIdsFor(opts.manifest.stack).flatMap((id) => {
            const a = opts.all.get(id)
            return a === undefined ? [] : [a]
          }),
    read: (f) => {
      try {
        return readFileSync(join(opts.dir, f), "utf8")
      } catch {
        return undefined
      }
    },
    here: (...commands) => inDir(rel, commands),
    efforge: (args) => `${BIN} ${args}${rel === "" ? "" : ` --cwd ${quote(rel)}`}`,
  }
}
