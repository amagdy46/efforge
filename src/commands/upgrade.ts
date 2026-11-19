import { readFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import { Console, Effect, FileSystem, Path, Schema } from "effect"
import { Command, Flag } from "effect/cli"
import pc from "picocolors"
import { loadAddons } from "../addon.ts"
import { BIN, type Failure, inDir, Invocation, printSuccess, quote, report } from "../contract.ts"
import { exec, has, INSTALL, INSTALL_ARGS } from "../exec.ts"
import { alternative, finish, withFlag } from "../fix.ts"
import { GenerateError } from "../generate.ts"
import { introLine } from "../intro.ts"
import { generateRouteTree } from "../routeTree.ts"
import { gitDiff, planUpgrade, type UpgradeReport, type UpgradeStep } from "../upgrade.ts"
import { efforgeVersion, pinSets } from "../versions.ts"
import { addFailure, readManifest } from "./add.ts"
import { PnpmMissing, TemplatesDir } from "./create.ts"

/** The project was made or last upgraded by a newer efforge than this one. */
export class ProjectNewerThanCli extends Schema.TaggedError<ProjectNewerThanCli>()(
  "ProjectNewerThanCli",
  { project: Schema.String },
) {}

/** `upgrade` in a git checkout with changes not yet committed. */
export class UncommittedChanges extends Schema.TaggedError<UncommittedChanges>()(
  "UncommittedChanges",
  { files: Schema.Array(Schema.String) },
) {}

/** `upgrade` wrote its files, then the install (or route tree) failed. */
export class UpgradeIncomplete extends Schema.TaggedError<UpgradeIncomplete>()(
  "UpgradeIncomplete",
  { command: Schema.String, output: Schema.String, partial: Schema.Unknown },
) {}

/** The exit code of a check that ran and found something that breaks the project. */
export const FOUND = 2
/** `upgrade --check --strict`: nothing breaks, and `upgrade` has something to apply. */
export const BEHIND = 3

export const upgradeFailure = (
  e: { readonly _tag: string } & Record<string, unknown>,
  args: ReadonlyArray<string>,
  dir: string,
): Failure => {
  switch (e._tag) {
    case "ProjectNewerThanCli": {
      const project = String(e.project)
      const command = alternative(args, (i) => i)?.replace(BIN, `${BIN}@latest`) ?? null
      return {
        code: "ProjectNewerThanCli",
        message: `This project was made or upgraded with efforge ${project}, newer than this CLI (${efforgeVersion}). An older efforge would undo what the newer one did, so it stops here.${command === null ? "" : ` Run ${command}.`}`,
        fix: null,
        details: { project, cli: efforgeVersion, ...(command === null ? {} : { command }) },
      }
    }
    case "UncommittedChanges": {
      const files = e.files as string[]
      const command = alternative(args, (i) => withFlag(i, "allow-dirty", true))
      return {
        code: "UncommittedChanges",
        message: `${relative(process.cwd(), dir) || "This project"} has changes that aren't committed (${files.slice(0, 3).join(", ")}${files.length > 3 ? `, +${files.length - 3} more` : ""}). Commit or stash them first, so git diff shows exactly what upgrade did. Nothing was written.${command === null ? "" : ` To apply on top of them anyway: ${command}`}`,
        fix: null,
        details: { files, ...(command === null ? {} : { command }) },
      }
    }
    case "UpgradeIncomplete": {
      const output = String(e.output).trim()
      return {
        code: "CommandFailed",
        message: `\`${String(e.command)}\` failed. The upgrade's files were written; run it yourself.`,
        fix: finish(args, dir, [String(e.command)]),
        details: {
          failed: String(e.command),
          output: output.split("\n").slice(-15).join("\n"),
          ...(e.partial as object),
        },
        more: output,
      }
    }
    default:
      return addFailure(e, args, dir)
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** At most `n` items, then `+k more`. */
const some = (items: ReadonlyArray<string>, n: number) =>
  items.length <= n
    ? items.join(", ")
    : `${items.slice(0, n).join(", ")}, +${items.length - n} more`

/** A step's command as it runs from where efforge was run: `--cwd` for efforge, else `cd`. */
const commandLineOf = (s: UpgradeStep) => {
  if (s.command === undefined) return undefined
  const rel = s.cwd === undefined ? "" : relative(process.cwd(), s.cwd)
  if (rel === "") return s.command
  return s.command.startsWith(BIN)
    ? `${s.command} --cwd ${quote(rel)}`
    : `cd ${quote(rel)} && ${s.command}`
}

/** The report for people: what breaks, then what to do; `verbose` lists every pin and file. */
export const renderUpgrade = (
  r: UpgradeReport,
  verbose: boolean,
  diff: boolean,
  only?: string,
): string => {
  const out: string[] = []
  const count = (s: string) => r.files.filter((f) => f.status === s && f.held === undefined).length
  const moving = r.pins.filter((p) => p.status === "behind" && p.held !== true)
  const made =
    r.project.status === "same"
      ? `Made with this efforge (${r.project.cli}).`
      : `Made with efforge ${r.project.efforgeVersion}; this is ${r.project.cli}.`
  const behind = [
    moving.length > 0 ? plural(moving.length, "pin") : undefined,
    count("refresh") > 0 ? `${plural(count("refresh"), "file")} to refresh` : undefined,
    count("new") > 0 ? plural(count("new"), "new file") : undefined,
    r.seams.length > 0
      ? `${plural(r.seams.length, "file")} to give what the new ones need`
      : undefined,
    r.scripts.some((s) => s.status === "behind")
      ? plural(r.scripts.filter((s) => s.status === "behind").length, "script")
      : undefined,
    r.removes.size > 0 ? `${r.removes.size} to remove` : undefined,
  ].filter((x) => x !== undefined)
  const head =
    r.status === "needs-action"
      ? `${pc.red("Needs action:")} ${plural(r.needsAction.length, "thing")} that ${r.needsAction.length === 1 ? "breaks" : "break"} the project.${r.changes.size + r.removes.size > 0 ? ` Behind: ${behind.join(", ") || "efforge.jsonc"}.` : ""}`
      : r.status === "behind"
        ? `${pc.yellow("Behind:")} ${behind.join(", ") || "efforge.jsonc to update"}. Nothing breaks the project.`
        : `${pc.green("Up to date:")} nothing to apply${r.kept.length > 0 ? `; ${plural(r.kept.length, "file")} you changed ${r.kept.length === 1 ? "differs" : "differ"} from efforge's templates (below)` : ""}.`
  out.push(`${made} ${head}`)
  for (const w of r.warnings) out.push(pc.yellow(w))

  if (r.needsAction.length > 0) {
    out.push("", pc.bold("Needs action"))
    for (const n of r.needsAction)
      out.push(
        `  ${pc.red("✗")} ${n.message}${n.fix !== null && n.fix.includes("upgrade") ? pc.dim(" (upgrade fixes it)") : ""}`,
      )
  }

  if (r.steps.length > 0) {
    out.push("", pc.bold("What to do"))
    r.steps.forEach((s, n) => {
      out.push(`  ${n + 1}. ${s.description}`)
      const cmd = commandLineOf(s)
      if (cmd !== undefined) out.push(`     ${pc.cyan(cmd)}`)
      if (s.id === "review")
        for (const k of r.kept) {
          out.push(`     ${pc.dim(k.status === "held" ? "held  " : "review")}  ${k.path}`)
          out.push(`             ${pc.dim(k.reason)}`)
          if (k.lines !== undefined && verbose)
            out.push(...k.lines.split("\n").map((l) => `               ${pc.dim(l)}`))
        }
      else if (s.files !== undefined)
        out.push(`     ${pc.dim(verbose ? s.files.join(", ") : some(s.files, 4))}`)
      if (s.lines !== undefined) {
        const lines = s.lines.trimEnd().split("\n")
        if (verbose || lines.length <= 4) out.push(...lines.map((l) => `       ${pc.dim(l)}`))
        else
          out.push(
            pc.dim(
              `       ${lines.length} lines in ${s.file ?? "the file"} (--verbose prints them)`,
            ),
          )
      }
    })
  }

  // the overview: one line each, details with --verbose
  const yours = r.pins.filter((p) => p.status === "yours")
  const groups = [...pinSets.map((s) => s.id), ""].filter((id) =>
    moving.some((p) => (p.set ?? "") === id),
  )
  out.push("")
  out.push(
    `${pc.bold("Versions")} ${pc.dim(`${moving.length} to move${groups.length > 0 ? ` (${groups.map((g) => g || "others").join(", ")})` : ""}, ${yours.length} yours, ${r.pins.filter((p) => p.status === "same").length} same`)}`,
  )
  const fileLine = ["current", "refresh", "new", "review", "yours", "deleted", "dropped"]
    .map((s) => [s, r.files.filter((f) => f.status === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`)
    .join(", ")
  out.push(`${pc.bold("Files")} ${pc.dim(fileLine)}`)
  if (verbose) {
    for (const id of [...pinSets.map((s) => s.id), ""]) {
      const ps = r.pins.filter(
        (p) => (p.set ?? "") === id && p.status !== "same" && p.status !== "unmanaged",
      )
      if (ps.length === 0) continue
      const set = r.sets.find((s) => s.id === id)
      out.push(
        `  ${pc.cyan(id === "" ? "others" : `${id}${set?.split === true ? " (split)" : ""}`)}: ${ps.map((p) => `${p.name} ${p.project}${p.status === "behind" ? ` → ${p.efforge}${p.held === true ? " (held: a pin of its set is yours)" : ""}` : " (yours)"}`).join(", ")}`,
      )
    }
    for (const f of r.files.filter((x) => x.status !== "current"))
      out.push(`  ${f.status.padEnd(7)}  ${f.path}${f.held === undefined ? "" : pc.dim(" (held)")}`)
    for (const s of r.seams) out.push(`  ${pc.cyan("seam")}     ${s.file}: ${s.missing.join("; ")}`)
    for (const x of r.scripts)
      out.push(
        `  ${pc.cyan("script")}   ${x.file} ${x.name}: ${x.yours} ${x.status === "behind" ? `→ ${x.efforge}` : "(yours)"}`,
      )
  } else if (
    r.files.some((f) => f.status !== "current") ||
    r.pins.some((p) => p.status !== "same" && p.status !== "unmanaged")
  )
    out.push(pc.dim("--verbose lists every pin and file; --diff shows each change."))

  if (diff) {
    const want = (path: string) => only === undefined || path === only
    for (const f of r.files.filter((x) => want(x.path) && x.diff !== undefined && x.diff !== ""))
      if (f.status !== "new" || verbose || only !== undefined) out.push("", f.diff?.trimEnd() ?? "")
    for (const s of r.seams.filter((x) => want(x.file))) out.push("", s.diff.trimEnd())
  }
  return out.join("\n")
}

/** The `--check` document. */
const checkDocument = (r: UpgradeReport, only: string | undefined) => ({
  check: true,
  directory: r.directory,
  stack: r.stack,
  efforgeVersion: {
    project: r.project.efforgeVersion,
    cli: r.project.cli,
    status: r.project.status,
  },
  status: r.status,
  needsAction: r.needsAction,
  pins: r.pins,
  sets: r.sets,
  guards: r.guards,
  files: only === undefined ? r.files : r.files.filter((f) => f.path === only),
  seams: r.seams,
  scripts: r.scripts,
  kept: r.kept,
  steps: r.steps,
  warnings: r.warnings,
})

const gitDirty = (dir: string) =>
  exec("git", ["status", "--porcelain", "--", "."], dir).pipe(
    Effect.map((out) =>
      out
        .split("\n")
        .map((l) => l.slice(3).trim())
        .filter((l) => l !== ""),
    ),
    // not a git checkout: nothing to mix with
    Effect.catchTag("CommandFailed", () => Effect.succeed(undefined)),
  )

export const upgradeCommand = Command.make(
  "upgrade",
  {
    check: Flag.Boolean("check").pipe(
      Flag.withDescription(
        "Report how this project differs from what this efforge generates; change nothing",
      ),
      Flag.withDefault(false),
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Show what upgrade would change; write nothing"),
      Flag.withDefault(false),
    ),
    diff: Flag.Boolean("diff").pipe(
      Flag.withDescription(
        "With --check or --dry-run: also show each file against efforge's version",
      ),
      Flag.withDefault(false),
    ),
    file: Flag.String("file").pipe(
      Flag.withDescription("With --diff: only this file (a path relative to the project)"),
      Flag.withDefault(""),
    ),
    verbose: Flag.Boolean("verbose").pipe(
      Flag.withDescription("List every pin and file, not only what needs doing"),
      Flag.withDefault(false),
    ),
    strict: Flag.Boolean("strict").pipe(
      Flag.withDescription(
        "With --check: exit 3 when upgrade has something to apply, even if nothing breaks",
      ),
      Flag.withDefault(false),
    ),
    allowDirty: Flag.Boolean("allow-dirty").pipe(
      Flag.withDescription("Apply even with uncommitted changes (git diff then mixes them)"),
      Flag.withDefault(false),
    ),
    install: Flag.Boolean("install").pipe(
      Flag.withDescription(
        "Run pnpm install afterwards when dependencies changed (--no-install to skip)",
      ),
      Flag.withDefault(true),
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription(
        "Print one JSON document on stdout, nothing else (https://github.com/amagdy46/efforge/blob/main/docs/json.md)",
      ),
      Flag.withDefault(false),
    ),
    cwd: Flag.String("cwd").pipe(
      Flag.withDescription("Project directory (default: current directory)"),
      Flag.withDefault("."),
    ),
  },
  (input) => {
    const dir = resolve(input.cwd)
    const rel = relative(process.cwd(), dir)
    const bin = (args: string) => `${BIN} ${args}${rel === "" ? "" : ` --cwd ${quote(rel)}`}`
    const only = input.file === "" ? undefined : input.file
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const manifest = yield* readManifest(dir)
      const addons = yield* loadAddons(yield* TemplatesDir)
      const r = yield* planUpgrade(dir, manifest, addons, {
        diff: input.diff,
        bin,
        here: (c) => inDir(rel, [c]),
      })
      // an older CLI would compare with older templates and undo what the newer one did
      if (r.project.status === "ahead")
        return yield* new ProjectNewerThanCli({ project: r.project.efforgeVersion })

      if (input.check) {
        if (input.json) yield* printSuccess(checkDocument(r, only))
        else {
          if (process.stdout.isTTY) yield* Console.log(introLine(`upgrade --check  ${rel || "."}`))
          yield* Console.log(renderUpgrade(r, input.verbose, input.diff, only))
        }
        const code =
          r.status === "needs-action" ? FOUND : input.strict && r.status === "behind" ? BEHIND : 0
        if (code !== 0)
          yield* Effect.sync(() => {
            process.exitCode = code
          })
        return
      }

      // apply: everything was computed in memory; only now touch the disk
      const created = [...r.changes.keys()].filter((f) => readText(dir, f) === undefined).toSorted()
      const changed = [...r.changes.keys()].filter((f) => !created.includes(f)).toSorted()
      const removed = [...r.removes].toSorted()
      const anything = r.changes.size + r.removes.size > 0
      const installs = input.install && !input.dryRun && r.installOwed
      if (anything && !input.dryRun) {
        if (input.install && r.installOwed && !(yield* has("pnpm"))) return yield* new PnpmMissing()
        if (!input.allowDirty) {
          const dirty = yield* gitDirty(dir)
          if (dirty !== undefined && dirty.length > 0)
            return yield* new UncommittedChanges({ files: dirty })
        }
        const io = (target: string) =>
          Effect.mapError(
            (e: { message: string }) =>
              new GenerateError({ reason: "io", path: target, message: e.message }),
          )
        for (const f of removed) yield* fs.remove(path.join(dir, f), { force: true }).pipe(io(f))
        for (const [f, content] of r.changes) {
          const abs = path.join(dir, f)
          yield* fs.makeDirectory(path.dirname(abs), { recursive: true }).pipe(io(f))
          yield* fs.writeFileString(abs, content).pipe(io(f))
        }
      }
      const partial = {
        directory: dir,
        created,
        changed,
        removed,
        nextSteps: [
          { command: "pnpm typecheck && pnpm check && pnpm test && pnpm build", cwd: dir },
        ],
      }
      const installedBefore = yield* fs
        .exists(path.join(dir, "node_modules", ".modules.yaml"))
        .pipe(Effect.orElseSucceed(() => false))
      if (!input.dryRun && (installs || (anything && installedBefore)))
        yield* Effect.gen(function* () {
          if (installs) {
            if (!input.json) yield* Console.log(pc.dim(`Installing dependencies (${INSTALL})`))
            yield* exec("pnpm", [...INSTALL_ARGS], dir)
          }
          yield* generateRouteTree(dir)
        }).pipe(
          Effect.catchTag("CommandFailed", (e) =>
            Effect.fail(new UpgradeIncomplete({ command: e.command, output: e.output, partial })),
          ),
        )
      // what is left: the project as it is now (a dry run: as it would be)
      const after =
        input.dryRun || !anything
          ? r
          : yield* planUpgrade(dir, yield* readManifest(dir), addons, {
              diff: false,
              bin,
              here: (c) => inDir(rel, [c]),
            })
      const needsAction = after.needsAction.filter(
        (n) => !(input.dryRun && n.fix === bin("upgrade")),
      )
      const nextSteps = [
        ...(!installs && r.installOwed && anything ? [{ command: INSTALL, cwd: dir }] : []),
        ...(anything || after.kept.length > 0
          ? [{ command: "pnpm typecheck && pnpm check && pnpm test && pnpm build", cwd: dir }]
          : []),
        ...(r.files.some((f) => f.status === "new" && /migrations?\//.test(f.path))
          ? [{ command: "pnpm db:migrate", cwd: dir }]
          : []),
      ]
      if (input.json)
        yield* printSuccess({
          check: false,
          dryRun: input.dryRun,
          directory: dir,
          stack: r.stack,
          efforgeVersion: {
            from: r.project.efforgeVersion,
            to: anything ? efforgeVersion : r.project.efforgeVersion,
          },
          status: input.dryRun
            ? needsAction.length > 0
              ? "needs-action"
              : "current"
            : after.status,
          created,
          changed,
          removed,
          installed: installs,
          kept: after.kept,
          needsAction,
          nextSteps,
          warnings: r.warnings,
          ...(input.diff
            ? {
                diff: [...r.changes]
                  .filter(([f]) => only === undefined || f === only)
                  .map(([f, c]) => gitDiff(f, readText(dir, f), c))
                  .join("\n"),
              }
            : {}),
        })
      else {
        if (process.stdout.isTTY)
          yield* Console.log(introLine(`upgrade${input.dryRun ? " --dry-run" : ""}  ${rel || "."}`))
        const lines: string[] = []
        if (!anything)
          lines.push(
            `${pc.green("Nothing to apply:")} the project has everything efforge ${efforgeVersion} can give it.`,
          )
        else {
          lines.push(
            `${input.dryRun ? "Would upgrade" : "Upgraded"} from efforge ${r.project.efforgeVersion} to ${efforgeVersion}${input.dryRun ? "" : installs ? ", and installed" : ""}:`,
          )
          for (const f of created) lines.push(`  ${pc.green("+")} ${f}`)
          for (const f of changed)
            lines.push(
              `  ${pc.yellow("~")} ${f}${r.seams.find((s) => s.file === f) === undefined ? "" : pc.dim(` (${r.seams.find((s) => s.file === f)?.missing.join("; ")})`)}`,
            )
          for (const f of removed) lines.push(`  ${pc.red("-")} ${f}`)
        }
        if (after.kept.length > 0) {
          lines.push(
            "",
            pc.bold(
              `${input.dryRun ? "Would keep" : "Kept"} as ${after.kept.length === 1 ? "it is" : "they are"}`,
            ),
          )
          for (const k of after.kept) lines.push(`  ${k.path}`, `    ${pc.dim(k.reason)}`)
          lines.push(
            `  ${pc.dim("efforge's version of each:")} ${pc.cyan(bin("upgrade --check --diff --file <path>"))}`,
          )
        }
        if (needsAction.length > 0) {
          lines.push("", pc.bold("Still needs action"))
          for (const n of needsAction)
            lines.push(
              `  ${pc.red("✗")} ${n.message}`,
              ...(n.lines === undefined
                ? []
                : n.lines.split("\n").map((l) => `      ${pc.dim(l)}`)),
            )
        }
        if (input.diff)
          for (const [f, c] of r.changes)
            if (only === undefined || f === only)
              lines.push("", gitDiff(f, readText(dir, f), c).trimEnd())
        if (nextSteps.length > 0 && !input.dryRun) {
          lines.push("", pc.bold("Next"))
          for (const s of nextSteps) lines.push(`  ${pc.cyan(inDir(rel, [s.command]))}`)
        }
        if (input.dryRun) lines.push("", pc.dim("dry run: nothing written"))
        else if (anything) lines.push("", `${pc.dim("Review the changes with")} git diff`)
        yield* Console.log(lines.join("\n"))
      }
      if (!input.dryRun && needsAction.length > 0)
        yield* Effect.sync(() => {
          process.exitCode = FOUND
        })
    }).pipe(
      Effect.catch((e) =>
        Effect.gen(function* () {
          const args = yield* Invocation
          yield* report(input.json, upgradeFailure(e as never, args, dir))
        }),
      ),
    )
  },
).pipe(
  Command.withDescription(
    "Bring this project up to date with this efforge, leaving your changes alone",
  ),
  Command.withExamples([
    {
      command: "npx create-efforge upgrade --check",
      description: "What differs, what breaks, and what to do",
    },
    {
      command: "npx create-efforge upgrade --dry-run",
      description: "What upgrade would change; write nothing",
    },
    {
      command: "npx create-efforge upgrade",
      description: "Apply it: pins, guards and the files that are still efforge's",
    },
    {
      command: "npx create-efforge upgrade --check --json",
      description: "The report as data; exit code 2 when something breaks the project",
    },
  ]),
)

const readText = (dir: string, file: string): string | undefined => {
  try {
    return readFileSync(resolve(dir, file), "utf8")
  } catch {
    return undefined
  }
}
