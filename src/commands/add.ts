import { Console, Effect, FileSystem, Path, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import type { ChildProcessSpawner } from "effect/process"
import { type ParseError, parse } from "jsonc-parser"
import pc from "picocolors"
import { parseDocument } from "yaml"
import { type AddonLoadError, addonIdsFor, loadAddons } from "../addon.ts"
import { unifiedDiff } from "../diff.ts"
import { type CommandFailed, exec } from "../exec.ts"
import { GenerateError, isComputed, matches } from "../generate.ts"
import { EfforgeManifest, hash, renderManifest } from "../manifest.ts"
import { applyProjectName } from "../projectName.ts"
import { IncompatibleStack, validate } from "../rules.ts"
import { type SlotDef, slots } from "../slots.ts"
import { type StackConfig, toCommand } from "../stack.ts"
import { ALCHEMY_FILE } from "../transforms/addAlchemyResource.ts"
import { AUTH_FILE } from "../transforms/addAuthPlugin.ts"
import { WRANGLER_FILE } from "../transforms/addWranglerBinding.ts"
import {
  runTransform,
  type TransformAnchorMissing,
  type UnknownTransform,
} from "../transforms/index.ts"
import { versions } from "../versions.ts"
import { TemplatesDir } from "./create.ts"

export class NotAnEfforgeProject extends Schema.TaggedError<NotAnEfforgeProject>()(
  "NotAnEfforgeProject",
  { dir: Schema.String, reason: Schema.String },
) {}

/** A target file that exists, differs from what efforge generated, and `--overwrite` wasn't given. */
export class OverlayConflict extends Schema.TaggedError<OverlayConflict>()("OverlayConflict", {
  file: Schema.String,
  diff: Schema.String,
}) {}

export interface AddOptions {
  readonly overwrite: boolean
  readonly dryRun: boolean
  /** Run `pnpm install` afterwards (default true; never when `dryRun`). */
  readonly install?: boolean
}

export interface AddResult {
  /** Overlay files created or replaced, plus package.json, workspace, env and manifest updates. */
  readonly written: string[]
  /** Existing seam files edited by transforms. */
  readonly transformed: string[]
  /** Ids already in the stack, and overlays that already match. */
  readonly skipped: string[]
}

export type AddError =
  | NotAnEfforgeProject
  | IncompatibleStack
  | OverlayConflict
  | TransformAnchorMissing
  | UnknownTransform
  | GenerateError
  | AddonLoadError
  | CommandFailed

const incompatible = (
  slot: IncompatibleStack["slot"],
  value: string,
  allowed: string[],
  reason: string,
) => new IncompatibleStack({ slot, value, allowed, reason })

const allIds = slots.flatMap((s) =>
  s.options.filter((o) => o.id !== "none").map((o) => `${s.id}/${o.id}`),
)

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** `email`, `extras/email`, `ai/effect-ai-byok`, `ai=effect-ai-byok` -> slot + option. */
const parseId = (
  id: string,
): Effect.Effect<{ slot: SlotDef; option: string }, IncompatibleStack> => {
  const [slotPart, option = ""] = id.includes("=")
    ? id.split("=", 2)
    : id.includes("/")
      ? id.split("/", 2)
      : [undefined, id]
  const unknown = (why: string) => Effect.fail(incompatible("extras", id, allIds, why))
  if (option === "none") return unknown("Removing an add-on isn't supported in v0.1.")
  const candidates = slots.filter(
    (s) => (slotPart === undefined || s.id === slotPart) && s.options.some((o) => o.id === option),
  )
  const [first] = candidates
  if (first === undefined) return unknown(`"${id}" is not an add-on.`)
  if (candidates.length > 1)
    return unknown(
      `"${id}" is ambiguous; write it as ${candidates.map((s) => `${s.id}/${id}`).join(" or ")}.`,
    )
  return Effect.succeed({ slot: first, option })
}

/** Applies `ids` to `stack`. Single-select slots may only go from `none` to a value. */
const applyIds = (
  stack: StackConfig,
  ids: ReadonlyArray<string>,
): Effect.Effect<{ stack: StackConfig; skipped: string[] }, IncompatibleStack> =>
  Effect.gen(function* () {
    let next = stack
    const skipped: string[] = []
    for (const id of ids) {
      const { slot, option } = yield* parseId(id)
      if (slot.id === "extras") {
        if (next.extras.includes(option as never)) skipped.push(`extras/${option}`)
        else {
          const order = slot.options.map((o) => o.id)
          const extras = [...next.extras, option as never].sort(
            (a, b) => order.indexOf(a) - order.indexOf(b),
          )
          next = { ...next, extras }
        }
        continue
      }
      const current = next[slot.id]
      if (current === option) skipped.push(`${slot.id}/${option}`)
      else if (current === "none") next = { ...next, [slot.id]: option } as StackConfig
      else
        return yield* incompatible(
          slot.id,
          option,
          [current],
          `${slot.id} is already "${current}"; swapping an existing choice isn't supported in v0.1. Create a new project to use a different ${slot.id}.`,
        )
    }
    return { stack: yield* validate(next), skipped }
  })

const readManifest = (
  dir: string,
): Effect.Effect<EfforgeManifest, NotAnEfforgeProject, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const fail = (reason: string) => new NotAnEfforgeProject({ dir, reason })
    const text = yield* fs
      .readFileString(path.join(dir, "efforge.jsonc"))
      .pipe(Effect.mapError(() => fail("efforge.jsonc not found")))
    const errors: ParseError[] = []
    const json = parse(text, errors, { allowTrailingComma: true }) as unknown
    if (errors.length > 0) return yield* fail("efforge.jsonc is not valid JSONC")
    return yield* Schema.decodeUnknownEffect(EfforgeManifest)(json).pipe(
      Effect.mapError((e) => fail(`efforge.jsonc is not a valid manifest: ${e.message}`)),
    )
  })

/**
 * Adds add-ons to an existing efforge project. Everything is computed in memory first
 * (overlays, transforms against the files on disk, dependency/env/manifest merges); nothing is
 * written unless all of it succeeds.
 */
export const addAddons = (
  dir: string,
  ids: ReadonlyArray<string>,
  opts: AddOptions,
): Effect.Effect<
  AddResult,
  AddError,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const templatesDir = yield* TemplatesDir
    const manifest = yield* readManifest(dir)
    const io = (target: string) =>
      Effect.mapError(
        (e: { message: string }) =>
          new GenerateError({ reason: "io", path: target, message: e.message }),
      )

    const disk = new Map<string, string | undefined>()
    const read = (rel: string) =>
      Effect.gen(function* () {
        if (disk.has(rel)) return disk.get(rel)
        const abs = path.join(dir, rel)
        const text = (yield* fs.exists(abs)) ? yield* fs.readFileString(abs) : undefined
        disk.set(rel, text)
        return text
      }).pipe(io(rel))

    // 1. resolve ids into the new stack
    const { stack, skipped: alreadyThere } = yield* applyIds(manifest.stack, ids)
    const before = new Set(addonIdsFor(manifest.stack))
    const newIds = addonIdsFor(stack).filter((id) => !before.has(id))
    const addons = yield* loadAddons(templatesDir)
    const fresh = []
    for (const id of newIds) {
      const a = addons.get(id)
      if (a === undefined)
        return yield* new GenerateError({
          reason: "unknown-addon",
          message: `add-on "${id}" is not loaded`,
        })
      fresh.push(a)
    }

    const skipped: string[] = [...alreadyThere]
    const out = new Map<string, string>() // path -> new content, everything to write
    const written = new Set<string>()
    const hashes: Record<string, string> = {}

    // 2. overlays: write if absent, replace if still what efforge generated, else conflict
    const overlays = new Map<string, string>()
    for (const { manifest: m, dir: addonDir } of fresh)
      for (const f of m.files) {
        if (!matches(f.when, stack) || isComputed(f.target)) continue
        overlays.set(
          f.target,
          yield* fs.readFileString(path.join(addonDir, f.path)).pipe(io(f.path)),
        )
      }
    const safe = (rel: string) => {
      const r = path.relative(dir, path.resolve(dir, rel))
      return (
        rel !== "" &&
        !path.isAbsolute(rel) &&
        r !== "" &&
        !r.startsWith("..") &&
        !path.isAbsolute(r)
      )
    }
    for (const target of overlays.keys())
      if (!safe(target))
        return yield* new GenerateError({
          reason: "unsafe-path",
          path: target,
          message: `add-on target "${target}" is outside the project directory`,
        })
    const tree = new Map<string, string>()
    const conflicts: Array<{ file: string; diff: string }> = []
    for (const [target, content] of applyProjectName(overlays, stack.name)) {
      const existing = yield* read(target)
      if (existing === content) {
        skipped.push(target)
      } else if (
        existing === undefined ||
        opts.overwrite ||
        manifest.files[target] === hash(existing)
      ) {
        out.set(target, content)
        written.add(target)
      } else {
        conflicts.push({ file: target, diff: unifiedDiff(target, existing, content) })
        continue
      }
      hashes[target] = hash(content)
      tree.set(target, content)
    }
    if (conflicts.length > 0)
      return yield* new OverlayConflict({
        file: conflicts.map((c) => c.file).join(", "),
        diff: conflicts.map((c) => c.diff).join("\n"),
      })

    // 3. transforms, against the current disk content of the seam files
    const active = fresh.flatMap(({ manifest: m }) =>
      m.transforms.filter((t) => matches(t.when, stack)),
    )
    const wanted = new Set([ALCHEMY_FILE, AUTH_FILE, WRANGLER_FILE])
    for (const t of active)
      if (t.args.file !== undefined) {
        if (!safe(t.args.file))
          return yield* new GenerateError({
            reason: "unsafe-path",
            path: t.args.file,
            message: `transform file "${t.args.file}" is outside the project directory`,
          })
        wanted.add(t.args.file)
      }
    for (const rel of wanted) {
      const text = yield* read(rel)
      if (text !== undefined && !tree.has(rel)) tree.set(rel, text)
    }
    let current: ReadonlyMap<string, string> = tree
    const seams = new Set<string>()
    for (const t of active) {
      const prev = current
      current = yield* runTransform(prev, t)
      for (const [file, content] of current)
        if (prev.get(file) !== content) {
          seams.add(file)
          if (content !== disk.get(file)) out.set(file, content)
          else out.delete(file)
        }
    }
    const transformed = new Set<string>()
    for (const file of seams) {
      // seam files are re-edited by transforms on every add, never hash-checked
      delete hashes[file]
      if (out.has(file)) (written.has(file) ? written : transformed).add(file)
    }

    // 4. dependencies merged into the existing package.json files
    const used = new Set<string>()
    const packages = new Map<string, string>()
    for (const { manifest: m } of fresh)
      for (const key of ["dependencies", "devDependencies"] as const)
        for (const [pkgDir, names] of Object.entries(m[key])) {
          const target = pkgDir === "." ? "package.json" : `${pkgDir}/package.json`
          const text = packages.get(target) ?? (yield* read(target))
          if (text === undefined)
            return yield* new GenerateError({
              reason: "missing-package-json",
              path: target,
              message: `${m.id} adds dependencies to ${target}, which does not exist`,
            })
          const pkg = yield* Effect.try({
            try: () => JSON.parse(text) as Record<string, unknown>,
            catch: (e) =>
              new GenerateError({
                reason: "invalid-json",
                path: target,
                message: `${target} is not valid JSON: ${String(e)}`,
              }),
          })
          const existing = (pkg[key] as Record<string, string> | undefined) ?? {}
          const deps = { ...existing }
          for (const name of names) {
            if (versions[name] === undefined)
              return yield* new GenerateError({
                reason: "unpinned",
                package: name,
                message: `${m.id} uses "${name}", which has no entry in versions.ts`,
              })
            used.add(name)
            if (!(name in deps)) deps[name] = "catalog:"
          }
          if (Object.keys(deps).length === Object.keys(existing).length) continue
          // keep the user's order unless they were already sorted
          const keys = Object.keys(existing)
          const ordered = keys.every((k, i) => i === 0 || byName(keys[i - 1] as string, k) <= 0)
            ? Object.fromEntries(Object.entries(deps).sort(([a], [b]) => byName(a, b)))
            : deps
          const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  "
          packages.set(
            target,
            `${JSON.stringify({ ...pkg, [key]: ordered }, null, indent)}${text.endsWith("\n") ? "\n" : ""}`,
          )
        }
    for (const [target, text] of packages) {
      out.set(target, text)
      written.add(target)
    }

    // 5. pnpm catalog
    if (used.size > 0) {
      const text = (yield* read("pnpm-workspace.yaml")) ?? "packages:\n  - apps/*\n  - packages/*\n"
      const doc = parseDocument(text)
      for (const name of [...used].sort())
        if (!doc.hasIn(["catalog", name])) doc.setIn(["catalog", name], versions[name])
      const next = doc.toString()
      if (next !== text) {
        out.set("pnpm-workspace.yaml", next)
        written.add("pnpm-workspace.yaml")
      }
    }

    // 6. env vars
    const envText = (yield* read(".env.example")) ?? ""
    const have = new Set(envText.split("\n").map((l) => l.split("=")[0]?.trim()))
    const groups: string[] = []
    for (const { manifest: m } of fresh) {
      const vars = m.envVars.filter((v) => !have.has(v.name))
      for (const v of vars) have.add(v.name)
      if (vars.length > 0)
        groups.push(`# ${m.title}\n${vars.map((v) => `${v.name}=${v.example}`).join("\n")}`)
    }
    if (groups.length > 0) {
      const base = envText === "" || envText.endsWith("\n") ? envText : `${envText}\n`
      out.set(".env.example", `${base}${base === "" ? "" : "\n"}${groups.join("\n\n")}\n`)
      written.add(".env.example")
    }

    // 7. efforge.jsonc
    if (newIds.length > 0) {
      out.set(
        "efforge.jsonc",
        renderManifest({
          efforgeVersion: manifest.efforgeVersion,
          stack,
          command: toCommand(stack),
          files: Object.fromEntries(
            Object.entries({ ...manifest.files, ...hashes })
              .filter(([file]) => !seams.has(file))
              .sort(([a], [b]) => byName(a, b)),
          ),
        }),
      )
      written.add("efforge.jsonc")
    }

    const result: AddResult = {
      written: [...written].sort(),
      transformed: [...transformed].sort(),
      skipped: skipped.sort(),
    }
    if (opts.dryRun) return result

    // all-or-nothing: only now touch the disk
    for (const [rel, content] of out) {
      const abs = path.join(dir, rel)
      yield* fs.makeDirectory(path.dirname(abs), { recursive: true }).pipe(io(rel))
      yield* fs.writeFileString(abs, content).pipe(io(rel))
    }
    if (out.size > 0 && opts.install !== false) yield* exec("pnpm", ["install"], dir)
    return result
  })

// --- CLI -----------------------------------------------------------------------

const describe = (
  e: { readonly _tag: string; readonly message?: string } & Record<string, unknown>,
): string => {
  switch (e._tag) {
    case "NotAnEfforgeProject":
      return `${String(e.dir)} is not an efforge project (${String(e.reason)}). Run this from the project root or pass --cwd.`
    case "IncompatibleStack":
      return `Can't add "${String(e.value)}" (${String(e.slot)}): ${typeof e.reason === "string" ? e.reason : "not compatible with the current stack."} Options: ${(e.allowed as string[]).join(", ")}`
    case "OverlayConflict":
      return `You've edited ${String(e.file)} since it was generated. Nothing was written. Re-run with --overwrite to replace it.\n\n${String(e.diff)}`
    case "TransformAnchorMissing":
      return `Couldn't find ${String(e.anchor)} in ${String(e.file)}. Nothing was written. Add this by hand, then re-run:\n${String(e.snippet)}`
    case "CommandFailed":
      return `\`${String(e.command)}\` failed. The files were written; run it yourself.\n${String(e.output).trim()}`
    default:
      return e.message ?? e._tag
  }
}

export const addConfig = {
  ids: Argument.String("ids").pipe(
    Argument.withDescription("Add-ons to add: email, extras/email, ai/effect-ai-byok, ..."),
    Argument.atLeast(1),
  ),
  overwrite: Flag.Boolean("overwrite").pipe(
    Flag.withDescription("Replace generated files you have edited"),
    Flag.withDefault(false),
  ),
  dryRun: Flag.Boolean("dry-run").pipe(
    Flag.withDescription("Print what would change; write nothing"),
    Flag.withDefault(false),
  ),
  json: Flag.Boolean("json").pipe(
    Flag.withDescription("Print the result as JSON on stdout"),
    Flag.withDefault(false),
  ),
  cwd: Flag.String("cwd").pipe(
    Flag.withDescription("Project directory (default: current directory)"),
    Flag.withDefault("."),
  ),
  install: Flag.Boolean("install").pipe(
    Flag.withDescription("Run pnpm install afterwards (--no-install to skip)"),
    Flag.withDefault(true),
  ),
}

export const addHandler = (input: {
  ids: ReadonlyArray<string>
  overwrite: boolean
  dryRun: boolean
  json: boolean
  cwd: string
  install: boolean
}) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const result = yield* addAddons(path.resolve(input.cwd), input.ids, {
      overwrite: input.overwrite,
      dryRun: input.dryRun,
      install: input.install,
    })
    if (input.json)
      return yield* Console.log(JSON.stringify({ dryRun: input.dryRun, ...result }, null, 2))
    const section = (title: string, files: string[]) =>
      files.length === 0 ? [] : [`${pc.bold(title)}\n${files.map((f) => `  ${f}`).join("\n")}`]
    yield* Console.log(
      [
        ...section(input.dryRun ? "Would write" : "Wrote", result.written),
        ...section(input.dryRun ? "Would edit" : "Edited", result.transformed),
        ...section("Unchanged", result.skipped),
        ...(result.written.length === 0 && result.transformed.length === 0
          ? ["Nothing to do."]
          : []),
        ...(input.dryRun ? [pc.dim("dry run: nothing written")] : []),
      ].join("\n\n"),
    )
  }).pipe(
    Effect.catch((e) =>
      Effect.gen(function* () {
        yield* Console.error(pc.red(describe(e as never)))
        yield* Effect.sync(() => {
          process.exitCode = 1
        })
      }),
    ),
  )

export const addCommand = Command.make("add", addConfig, addHandler).pipe(
  Command.withDescription("Add an add-on to an existing efforge project"),
)
