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
import { localEnvFile } from "./env.ts"
import { INSTALL } from "./exec.ts"
import { matches } from "./generate.ts"
import { installOwed } from "./installed.ts"
import type { EfforgeManifest } from "./manifest.ts"
import type { UpgradeReport } from "./upgrade.ts"
import { compareVersions, satisfies } from "./semver.ts"
import type { StackConfig } from "./stack.ts"
import type { TransformCall } from "./transforms/index.ts"
import { Node, SyntaxKind } from "ts-morph"
import { parseTs } from "./transforms/util.ts"
import { missingOverrides, pinnedPnpm, planUpgrade, readWorkspace } from "./upgrade.ts"
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

/** `unverified`: the check couldn't read what it looks for in the shape it knows; `details` says what. */
export type CheckStatus = "ok" | "warn" | "fail" | "skipped" | "unverified"

export interface CheckResult {
  readonly id: string
  readonly status: CheckStatus
  /** One or two sentences: what was found and why it matters. */
  readonly message: string
  /**
   * A command after which this check passes and no other check is worse, or null (then
   * `message` and `details` say what to change).
   */
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
  /** Files with uncommitted changes under `dir`, or undefined when it isn't in a git checkout. */
  readonly dirty: (dir: string) => string[] | undefined
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
  dirty: (dir) => {
    const r = spawnText("git", ["status", "--porcelain", "--", "."], dir, 30_000)
    if (r === undefined || r.status !== 0) return undefined
    return r.stdout
      .split("\n")
      .map((l) => l.slice(3).trim())
      .filter((l) => l !== "")
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
  /** What `upgrade` would do here, computed once; undefined when it can't be computed. */
  readonly plan: Effect.Effect<UpgradeReport | undefined, never, FileSystem.FileSystem | Path.Path>
}

/**
 * `upgrade` as a check's fix: only when it has something to apply, the project isn't newer than
 * this CLI, and there is nothing uncommitted (upgrade refuses that, and the fix must work).
 */
const upgradeFix = (ctx: DoctorContext, plan: UpgradeReport | undefined): string | null => {
  if (plan === undefined || plan.project.status === "ahead") return null
  if (plan.changes.size + plan.removes.size === 0 && !plan.installOwed) return null
  if ((ctx.probe.dirty(ctx.dir) ?? []).length > 0) return null
  return ctx.efforge("upgrade")
}

/** Why `upgradeFix` is null, for `details`. */
const upgradeFacts = (ctx: DoctorContext, plan: UpgradeReport | undefined) => {
  const dirty = ctx.probe.dirty(ctx.dir) ?? []
  return dirty.length > 0
    ? {
        command: ctx.efforge("upgrade"),
        uncommitted: dirty,
        reason: "commit or stash first: upgrade refuses uncommitted changes",
      }
    : plan?.project.status === "ahead"
      ? {
          command: ctx.efforge("upgrade").replace(BIN, `${BIN}@latest`),
          reason: `the project is from efforge ${plan.project.efforgeVersion}, newer than this CLI`,
        }
      : { command: ctx.efforge("upgrade --check") }
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
    Effect.gen(function* () {
      const global = ctx.probe.pnpmVersion()
      const pin = pinnedPnpm(json(ctx.read("package.json"))?.packageManager)
      if (global === undefined)
        return {
          status: "fail" as const,
          message: "pnpm isn't on your PATH, and efforge projects use it.",
          fix: "npm install --global pnpm",
        }
      const declared = json(ctx.read("package.json"))?.packageManager
      if (pin === undefined)
        return {
          status: "warn" as const,
          message:
            typeof declared === "string" && declared !== ""
              ? `package.json pins ${declared} in packageManager, and efforge projects are pnpm workspaces (pnpm-workspace.yaml, catalog:, the Effect overrides). efforge pins pnpm@${pnpmVersion}.`
              : `pnpm ${global}; package.json has no packageManager, so every machine installs with whatever pnpm it has. efforge pins pnpm@${pnpmVersion}.`,
          fix: ctx.here(`npm pkg set packageManager=pnpm@${pnpmVersion}`),
          details: { pnpm: global },
        }
      if (compareVersions(pin, pnpmWildcardOverrides) < 0) {
        // when upgrade has more to do (the Effect guard it needs), one fix does all of it
        const plan = yield* ctx.plan
        const upgrade =
          plan?.covers.includes("effect-overrides") === true ? upgradeFix(ctx, plan) : null
        return {
          status: "fail" as const,
          message: `packageManager pins pnpm ${pin}, which ignores the overrides that keep Effect's packages on one version (they work from pnpm ${pnpmWildcardOverrides}).${upgrade === null ? "" : " upgrade raises it with the overrides."}`,
          fix: upgrade ?? ctx.here(`npm pkg set packageManager=pnpm@${pnpmVersion}`, INSTALL),
          details: { pnpm: global, packageManager: pin },
        }
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
          message: existsSync(join(ctx.dir, "node_modules"))
            ? "node_modules wasn't installed by pnpm (it has no .modules.yaml), and efforge projects are pnpm workspaces."
            : "Dependencies aren't installed (no node_modules).",
          fix: ctx.here(INSTALL),
        }
      if (installOwed(ctx.dir))
        return {
          status: "fail" as const,
          message:
            "node_modules doesn't match the package.json files, pnpm-workspace.yaml or pnpm-lock.yaml: something changed them after the last install, or an install didn't finish.",
          fix: ctx.here(INSTALL),
        }
      if (ctx.read("pnpm-lock.yaml") === undefined)
        return {
          status: "warn" as const,
          message: "There is no pnpm-lock.yaml, so each install can resolve different versions.",
          fix: ctx.here(INSTALL),
        }
      return ok(
        "node_modules matches the package.json files, pnpm-workspace.yaml and pnpm-lock.yaml.",
      )
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
    Effect.gen(function* () {
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
      const plan = guard ? undefined : yield* ctx.plan
      const fix = guard ? ctx.here(INSTALL) : upgradeFix(ctx, plan)
      return {
        status: "fail" as const,
        message: `effect is ${pin}, but ${off.join(", ")} resolved to another version: two Effects in one build, which fails (Effect's packages only work at one shared version). ${guard ? "The overrides are in place, so a fresh install fixes it." : "pnpm-workspace.yaml lacks the overrides that prevent it; upgrade writes them and installs."}`,
        fix,
        details: {
          effect: pin,
          others: off,
          lockfile: lock.file,
          ...(fix === null ? upgradeFacts(ctx, plan) : {}),
        },
      }
    }),
}

const guardCheck: Check = {
  id: "effect-guard",
  title: "Effect overrides",
  run: (ctx) =>
    Effect.gen(function* () {
      const { catalog, overrides } = readWorkspace(ctx.dir)
      const effect = catalog.effect
      if (effect === undefined) return skipped("The catalog has no effect pin.")
      const missing = missingOverrides(overrides, effect)
      if (missing.length === 0)
        return ok(`pnpm-workspace.yaml holds every Effect package at ${effect}.`)
      const plan = yield* ctx.plan
      const fix = upgradeFix(ctx, plan)
      return {
        status: "warn" as const,
        message: `pnpm-workspace.yaml ${missing.length === Object.keys(effectOverrides(effect)).length ? "has no overrides holding Effect's packages" : `doesn't hold every Effect package (${missing.join(", ")})`} at ${effect}, so the next install can put a newer one next to it and break the build. upgrade writes them.`,
        fix,
        details: { missing, ...(fix === null ? upgradeFacts(ctx, plan) : {}) },
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
    Effect.gen(function* () {
      if (!existsSync(join(ctx.dir, "node_modules", ".modules.yaml")))
        return skipped("Nothing is installed yet.")
      const pin = pinnedPnpm(json(ctx.read("package.json"))?.packageManager)
      const global = ctx.probe.pnpmVersion()
      // in the project pnpm switches to the pinned version, which it may have to download; when
      // that version made node_modules, it is on this machine already
      const installedWith = /"packageManager":\s*"pnpm@([^"]+)"/.exec(
        ctx.read("node_modules/.modules.yaml") ?? "",
      )?.[1]
      if (
        !ctx.online &&
        pin !== undefined &&
        global !== undefined &&
        pin !== global &&
        installedWith !== pin
      )
        return {
          status: "skipped" as const,
          message: `pnpm ${pin} (packageManager) runs peers here, your PATH has ${global}, and node_modules was installed by ${installedWith === undefined ? "another pnpm" : `pnpm ${installedWith}`}, so running it may download ${pin}. Run ${ctx.here("pnpm peers check")} yourself, or doctor --online.`,
          fix: null,
          details: { packageManager: pin, path: global, installedWith: installedWith ?? null },
        }
      const out = ctx.probe.peers(ctx.dir)
      let report: unknown
      try {
        report = out === undefined ? undefined : JSON.parse(out)
      } catch {}
      if (report === undefined) return skipped("pnpm peers check didn't run or printed no report.")
      const { unmet, known } = classifyPeers(report)
      if (unmet.length > 0) {
        // Effect peers out of range are two Effects: upgrade's overrides and pins settle them
        const effectOnly = unmet.every((u) =>
          isEffectLockstep(u.split(": ")[1]?.split(" ")[0] ?? ""),
        )
        const plan = effectOnly ? yield* ctx.plan : undefined
        const fix =
          plan?.covers.includes("effect-overrides") === true ? upgradeFix(ctx, plan) : null
        return {
          status: "fail" as const,
          message: `${unmet.length} unmet peer ${unmet.length === 1 ? "dependency" : "dependencies"}: ${unmet.slice(0, 3).join("; ")}${unmet.length > 3 ? "; ..." : ""}.${fix === null ? "" : " They are Effect's: upgrade holds every Effect package at one version."}`,
          fix,
          details: { unmet, known },
        }
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
    // `NAME=   # todo`: a comment is not a value
    const raw = (m[2] as string).trim()
    const value = /^['"]/.test(raw) ? raw : raw.replace(/(^|\s)#.*$/, "").trim()
    out.set(m[1] as string, value.replace(/^(['"])(.*)\1$/, "$2"))
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
  /** `fill-in`: a secret only you have, which efforge wrote empty for you to fill in. */
  readonly status: "ok" | "missing" | "empty" | "fill-in" | "placeholder" | "undocumented"
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
      // the value each add-on gives for local development (`dev` in addon.json)
      const devValues = new Map<string, string>()
      for (const { manifest } of ctx.addons)
        for (const v of manifest.envVars)
          if (v.dev !== undefined && matches(v.when, stack) && !devValues.has(v.name))
            devValues.set(v.name, v.dev)
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
              ? // a real secret efforge writes empty ("Fill in" in .env.example): yours to fill
                declared.has(name) && !devValues.has(name)
                ? "fill-in"
                : "empty"
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
      const soft = findings.filter(
        (f) => f.status === "placeholder" || f.status === "undocumented" || f.status === "fill-in",
      )
      const describe = (fs: ReadonlyArray<EnvFinding>) =>
        fs
          .map(
            (f) =>
              `${f.name} (${f.status === "undocumented" ? "not in .env.example" : f.status === "fill-in" ? "yours to fill in" : f.status})`,
          )
          .join(", ")
      const details = { file, vars: findings }
      if (bad.length > 0) {
        // efforge's local value for each, when it has one (a real secret has none)
        const lines = bad.flatMap((f) => {
          const v = devValues.get(f.name)
          return v === undefined || v === "" ? [] : [`${f.name}=${v}`]
        })
        // an empty line is replaced, not followed by a second one
        const emptied = bad.filter((f) => values.has(f.name)).map((f) => f.name)
        return {
          status: "fail" as const,
          message: `${local === undefined ? `There is no ${file}, so the` : "The"} app reads ${bad.length === 1 ? "a setting" : "settings"} that ${file} doesn't set: ${describe(bad)}. ${bad.length === 1 ? "It fails" : "They fail"} at startup with a "not configured" page. See .env.example for what each is.${soft.length > 0 ? ` Also: ${describe(soft)}.` : ""}`,
          // with Alchemy, create's next step is to copy the example; without, efforge's local values
          fix:
            local === undefined && file === ".env" && ctx.read(".env.example") !== undefined
              ? ctx.here("cp .env.example .env")
              : lines.length !== bad.length
                ? null
                : emptied.length === 0
                  ? ctx.here(`printf '%s\\n' ${lines.map(quote).join(" ")} >> ${file}`)
                  : ctx.here(
                      `{ grep -v -E ${quote(`^(${emptied.join("|")})=`)} ${file}; printf '%s\\n' ${lines.map(quote).join(" ")}; } > ${file}.new && mv ${file}.new ${file}`,
                    ),
          details,
        }
      }
      if (soft.length > 0)
        return {
          status: "warn" as const,
          message: `${describe(soft)}. A placeholder, or a secret left to fill in, works until the feature that reads it is used, which then shows "not configured"; set real values before you use it or deploy (${stack.infra === "alchemy" ? "your deploy environment's variables, which Alchemy reads" : "wrangler secret put NAME, or your deploy workflow's secrets"}).`,
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
        // read as code, so a commented-out binding doesn't count and a renamed variable does
        const env = envObjectOf(file, text)
        if (env === undefined)
          return {
            status: "unverified" as const,
            message: `Couldn't find the Worker's \`env: { ... }\` (or \`bindings:\`) object in ${file}, so the ${wanted.length} bindings this stack needs (${wanted.map(({ t }) => t.args.binding ?? t.args.name).join(", ")}) weren't checked.`,
            fix: null,
            details: { file, lookedFor: wanted.map(({ t }) => t.args.binding ?? t.args.name) },
          }
        const lacking = wanted.filter(({ t }) => !env.has(String(t.args.binding ?? t.args.name)))
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
      // read as code: a commented-out layer doesn't count, and AppLayer built from another const does
      const used = appLayerNames(LAYERS, text)
      if (used === undefined)
        return {
          status: "unverified" as const,
          message: `Couldn't find \`export const AppLayer = ...\` in ${LAYERS}, so the layers this stack needs (${wanted.map(({ t }) => t.args.import).join(", ")}) weren't checked.`,
          fix: null,
          details: { file: LAYERS, lookedFor: wanted.map(({ t }) => t.args.import) },
        }
      const imported = importedNames(LAYERS, text)
      const name = (t: TransformCall) => t.args.import as string
      // imported but not composed: commented out, or dropped from the list
      const lacking = wanted.filter(({ t }) => imported.has(name(t)) && !used.has(name(t)))
      // neither imported nor used: replaced by a layer of yours, which efforge can't read
      const replaced = wanted.filter(({ t }) => !imported.has(name(t)) && !used.has(name(t)))
      if (lacking.length > 0)
        return {
          status: "fail" as const,
          message: `AppLayer in ${LAYERS} imports ${lacking.map(({ t, addon }) => `${t.args.import} (${addon.id})`).join(", ")} but doesn't use ${lacking.length === 1 ? "it" : "them"}, so the services ${lacking.length === 1 ? "it provides fail" : "they provide fail"} at runtime with a missing service.`,
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
      if (replaced.length > 0)
        return {
          status: "unverified" as const,
          message: `AppLayer in ${LAYERS} has no ${replaced.map(({ t, addon }) => `${t.args.import} (${addon.id})`).join(", ")}. If a layer of yours provides the same services, that's fine; efforge can't tell.`,
          fix: null,
          details: {
            file: LAYERS,
            lookedFor: replaced.map(({ t }) => ({
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

/** Local names imported into `text`. */
const importedNames = (file: string, text: string): Set<string> =>
  new Set(
    parseTs(file, text)
      .getImportDeclarations()
      .flatMap((d) =>
        d
          .getNamedImports()
          .map((n) => n.getAliasNode()?.getText() ?? n.getName())
          .concat(d.getDefaultImport()?.getText() ?? [])
          .concat(d.getNamespaceImport()?.getText() ?? []),
      ),
  )

/**
 * Every identifier AppLayer's initializer mentions, following the file's own consts it uses
 * (`const Base = Layer.mergeAll(...)`); undefined without an AppLayer. Comments aren't code.
 */
export const appLayerNames = (file: string, text: string): Set<string> | undefined => {
  const sf = parseTs(file, text)
  const app = sf.getVariableDeclaration("AppLayer")
  const init = app?.getInitializer()
  if (init === undefined) return undefined
  const out = new Set<string>()
  const visit = (node: Node) => {
    for (const id of node.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const name = id.getText()
      if (out.has(name)) continue
      out.add(name)
      const local = sf.getVariableDeclaration(name)?.getInitializer()
      if (local !== undefined && name !== "AppLayer") visit(local)
    }
  }
  visit(init)
  return out
}

/** The keys of the Worker's `env:` (or `bindings:`) object in alchemy.run.ts; undefined without one. */
export const envObjectOf = (file: string, text: string): Set<string> | undefined => {
  const sf = parseTs(file, text)
  const prop = sf
    .getDescendantsOfKind(SyntaxKind.PropertyAssignment)
    .find(
      (p) =>
        ["env", "bindings"].includes(p.getName()) &&
        Node.isObjectLiteralExpression(p.getInitializer()),
    )
  const obj = prop?.getInitializer()
  if (obj === undefined || !Node.isObjectLiteralExpression(obj)) return undefined
  return new Set(
    obj
      .getProperties()
      .flatMap((p) =>
        Node.isPropertyAssignment(p) || Node.isShorthandPropertyAssignment(p)
          ? [p.getName().replace(/^["']|["']$/g, "")]
          : [],
      ),
  )
}

const needsLabel: Record<string, string> = {
  "effect-overrides": "the Effect overrides",
  "package-manager": "packageManager",
  "split-set": "a set of pins half moved",
  "missing-seam": "an import of something missing",
  install: "an install owed",
}

const upgradeCheck: Check = {
  id: "upgrade",
  title: "Compared with this efforge",
  run: (ctx) =>
    Effect.gen(function* () {
      const manifest = ctx.manifest
      if (manifest === undefined) return skipped("efforge.jsonc isn't valid.")
      const report = yield* ctx.plan
      if (report === undefined)
        return skipped(`Couldn't render efforge ${efforgeVersion}'s templates for this stack.`)
      const made = `Made with efforge ${manifest.efforgeVersion}`
      if (report.project.status === "ahead")
        return {
          status: "skipped" as const,
          message: `${made}, newer than this CLI (${efforgeVersion}); compare with that one: ${ctx.efforge("doctor").replace(BIN, `${BIN}@latest`)}.`,
          fix: null,
        }
      const fix = upgradeFix(ctx, report)
      const facts = {
        status: report.status,
        needsAction: report.needsAction.map((n) => n.id),
        ...(fix === null ? upgradeFacts(ctx, report) : {}),
      }
      if (report.status === "needs-action") {
        // upgrade fixes it when every item is one upgrade writes or installs
        const fixable = report.needsAction.every((n) => n.fix !== null)
        return {
          status: "fail" as const,
          message: `${made}; ${report.needsAction.length === 1 ? "1 thing breaks" : `${report.needsAction.length} things break`} the project (${report.needsAction.map((n) => needsLabel[n.id]).join(", ")})${fixable ? ", and upgrade fixes it" : ""}. upgrade --check says more.`,
          fix: fixable ? fix : null,
          details: facts,
        }
      }
      if (report.status === "behind")
        return {
          status: "warn" as const,
          message: `${made}; efforge ${efforgeVersion} has newer pins or templates for it (${report.covers.join(", ")}). upgrade applies them and leaves your changes alone.`,
          fix,
          details: facts,
        }
      return ok(
        `${made}; nothing to apply from efforge ${efforgeVersion}${report.kept.length > 0 ? ` (${report.kept.length} ${report.kept.length === 1 ? "file is" : "files are"} kept as ${report.kept.length === 1 ? "it is" : "they are"}; upgrade --check says why)` : ""}.`,
        { status: report.status },
      )
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

/** The worst status of `results`: fail, then warn (or a check that couldn't verify), then ok. */
export const overall = (results: ReadonlyArray<CheckResult>): "ok" | "warn" | "fail" =>
  results.some((r) => r.status === "fail")
    ? "fail"
    : results.some((r) => r.status === "warn" || r.status === "unverified")
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
  /** doctor ran with --json: an efforge fix keeps it. */
  readonly json?: boolean
}): DoctorContext => {
  const rel = relative(process.cwd(), opts.dir)
  const efforge = (args: string) =>
    `${BIN} ${args}${opts.json === true && !args.includes("--json") ? " --json" : ""}${rel === "" ? "" : ` --cwd ${quote(rel)}`}`
  let planned: UpgradeReport | undefined | null = null
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
    efforge,
    plan: Effect.suspend(() => {
      if (planned !== null) return Effect.succeed(planned)
      const manifest = opts.manifest
      if (manifest === undefined) return Effect.succeed(undefined)
      return planUpgrade(opts.dir, manifest, opts.all, {
        diff: false,
        bin: efforge,
        here: (c) => inDir(rel, [c]),
      }).pipe(
        Effect.map((r) => r as UpgradeReport | undefined),
        Effect.catch(() => Effect.succeed(undefined)),
        Effect.tap((r) =>
          Effect.sync(() => {
            planned = r
          }),
        ),
      )
    }),
  }
}
