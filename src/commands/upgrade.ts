import { relative, resolve } from "node:path"
import { Console, Effect, Schema } from "effect"
import { Command, Flag } from "effect/cli"
import pc from "picocolors"
import { loadAddons } from "../addon.ts"
import { type Failure, Invocation, printSuccess, quote, report } from "../contract.ts"
import { alternative, withFlag } from "../fix.ts"
import { introLine } from "../intro.ts"
import type { Pin, UpgradeReport, UpgradeStep } from "../upgrade.ts"
import { checkUpgrade } from "../upgrade.ts"
import { efforgeVersion, pinSets } from "../versions.ts"
import { addFailure, readManifest } from "./add.ts"
import { TemplatesDir } from "./create.ts"

/** `upgrade` without `--check`: applying changes isn't there yet. */
export class UpgradeNeedsCheck extends Schema.TaggedError<UpgradeNeedsCheck>()(
  "UpgradeNeedsCheck",
  {},
) {}

/** The exit code of a check that ran and found something to do (`upgrade --check`, `doctor`). */
export const FOUND = 2

export const upgradeFailure = (
  e: { readonly _tag: string } & Record<string, unknown>,
  args: ReadonlyArray<string>,
): Failure => {
  if (e._tag !== "UpgradeNeedsCheck") return addFailure(e, args)
  const command = alternative(args, (i) => withFlag(i, "check", true))
  return {
    code: "UpgradeNeedsCheck",
    message: `efforge can't apply an upgrade yet; it can show what differs from efforge ${efforgeVersion} and what to do about it.${command === null ? "" : ` Run ${command}.`}`,
    fix: null,
    details: command === null ? {} : { command },
  }
}

const arrow = (p: Pin) => `${p.name} ${p.project} → ${p.efforge}`

/** At most `n` items, then `+k more`. */
const some = (items: ReadonlyArray<string>, n: number) =>
  items.length <= n
    ? items.join(", ")
    : `${items.slice(0, n).join(", ")}, +${items.length - n} more`

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The report for people: a summary, then only what needs doing; `verbose` lists everything. */
export const renderUpgrade = (r: UpgradeReport, verbose: boolean, diff: boolean): string => {
  const out: string[] = []
  const behind = r.pins.filter((p) => p.status === "behind")
  const ahead = r.pins.filter((p) => p.status === "ahead")
  const same = r.pins.filter((p) => p.status === "same")
  const unmanaged = r.pins.filter((p) => p.status === "unmanaged")
  const count = (s: string) => r.files.filter((f) => f.status === s).length
  const failing = r.guards.filter((g) => !g.ok)
  const made =
    r.project.status === "same"
      ? `Made with this efforge (${r.project.cli}).`
      : `Made with efforge ${r.project.efforgeVersion}; this is ${r.project.cli}.`
  const parts = [
    failing.length > 0 ? plural(failing.length, "guard") + " missing" : undefined,
    behind.length > 0
      ? `${behind.length} ${behind.length === 1 ? "pin" : "pins"} behind`
      : undefined,
    count("refresh") > 0 ? `${plural(count("refresh"), "file")} to refresh` : undefined,
    r.seams.length > 0 ? `${plural(r.seams.length, "file")} missing what efforge adds` : undefined,
    count("new") > 0 ? plural(count("new"), "new file") : undefined,
  ].filter((x) => x !== undefined)
  out.push(
    r.drifted
      ? `${made} ${pc.yellow("Drifted:")} ${parts.join(", ")}.`
      : r.steps.length === 0
        ? `${made} ${pc.green("Nothing to do:")} the project matches what efforge ${r.project.cli} generates for its stack.`
        : `${made} ${pc.green("Nothing efforge can change for you.")} Some files or scripts differ from its templates where it can't tell whose change it is; look at them below.`,
  )
  for (const w of r.warnings) out.push(pc.yellow(w))

  if (failing.length > 0 || verbose) {
    out.push("", pc.bold("Guards"))
    for (const g of r.guards) out.push(`  ${g.ok ? pc.green("✓") : pc.red("✗")} ${g.message}`)
  }

  const pinLine = `${behind.length} behind, ${ahead.length} ahead, ${same.length} same${unmanaged.length > 0 ? `, ${unmanaged.length} not managed by efforge` : ""}`
  if (behind.length > 0 || ahead.length > 0 || verbose) {
    out.push("", `${pc.bold("Versions")} ${pc.dim(`(${pinLine})`)}`)
    const groups = [...pinSets.map((s) => s.id), ""]
    for (const id of groups) {
      const moved = r.pins.filter(
        (p) => (p.set ?? "") === id && (p.status === "behind" || p.status === "ahead"),
      )
      if (moved.length === 0) continue
      const set = r.sets.find((s) => s.id === id)
      const name =
        id === ""
          ? "others"
          : `${id}${set?.split === true ? " (half moved: move it as one)" : " (moves together)"}`
      out.push(
        `  ${pc.cyan(name)}: ${verbose ? moved.map(arrow).join(", ") : some(moved.map(arrow), 3)}`,
      )
    }
    if (verbose) {
      if (same.length > 0) out.push(`  ${pc.dim(`same: ${same.map((p) => p.name).join(", ")}`)}`)
      if (unmanaged.length > 0)
        out.push(
          `  ${pc.dim(`not managed by efforge: ${unmanaged.map((p) => `${p.name} ${p.project}`).join(", ")}`)}`,
        )
    }
  }

  const fileLine = ["current", "refresh", "review", "differs", "yours", "deleted", "dropped", "new"]
    .filter((s) => count(s) > 0)
    .map((s) => `${count(s)} ${s}`)
    .join(", ")
  const shown = r.files.filter((f) =>
    verbose
      ? f.status !== "current"
      : f.status === "refresh" || f.status === "review" || f.status === "differs",
  )
  if (shown.length > 0 || count("new") > 0 || verbose) {
    out.push("", `${pc.bold("Generated files")} ${pc.dim(`(${fileLine})`)}`)
    const cut = verbose ? shown : shown.slice(0, 5)
    for (const f of cut) out.push(`  ${f.status.padEnd(7)}  ${f.path}`)
    if (cut.length < shown.length)
      out.push(pc.dim(`  … ${shown.length - cut.length} more (--verbose)`))
    if (!verbose && count("new") > 0)
      out.push(
        pc.dim(
          `  ${plural(count("new"), "file")} efforge generates today ${count("new") === 1 ? "isn't" : "aren't"} in this project; --verbose lists them.`,
        ),
      )
  }

  if (r.seams.length > 0) {
    out.push("", pc.bold("Seams"))
    for (const s of r.seams) out.push(`  ${s.file}: ${some(s.missing, 3)}`)
  }

  if (r.scripts.length > 0) {
    out.push("", pc.bold("Scripts"))
    for (const x of r.scripts)
      out.push(`  ${x.file} ${x.name}: ${x.yours} ${pc.dim("→ efforge today:")} ${x.efforge}`)
  }

  if (r.steps.length > 0) {
    out.push("", pc.bold("What to do"))
    r.steps.forEach((s: UpgradeStep, n) => {
      out.push(
        `  ${n + 1}. ${s.description}${s.byAdd === true ? pc.dim(" (efforge add also does this.)") : ""}`,
      )
      if (s.command !== undefined) {
        const rel = s.cwd === undefined ? "" : relative(process.cwd(), s.cwd)
        out.push(`     ${pc.cyan(rel === "" ? s.command : `cd ${quote(rel)} && ${s.command}`)}`)
      }
      if (s.files !== undefined && s.lines === undefined)
        out.push(`     ${pc.dim(verbose ? s.files.join(", ") : some(s.files, 4))}`)
      if (s.lines !== undefined) {
        const lines = s.lines.trimEnd().split("\n")
        if (verbose || lines.length <= 3) out.push(...lines.map((l) => `       ${pc.dim(l)}`))
        else
          out.push(
            pc.dim(
              `       ${lines.length} lines in ${s.file ?? "the file"} (--verbose prints them)`,
            ),
          )
      }
    })
  }

  if (diff) {
    const diffs = r.files.filter((f) => f.diff !== undefined && f.diff !== "")
    for (const f of diffs.filter((x) => x.status !== "new" || verbose))
      out.push("", f.diff?.trimEnd() ?? "")
    for (const s of r.seams) out.push("", s.diff.trimEnd())
  }
  return out.join("\n")
}

export const upgradeCommand = Command.make(
  "upgrade",
  {
    check: Flag.Boolean("check").pipe(
      Flag.withDescription(
        "Report how this project differs from what this efforge generates; change nothing",
      ),
      Flag.withDefault(false),
    ),
    patch: Flag.Boolean("patch").pipe(
      Flag.withDescription(
        "Print only a git patch of every change that keeps your edits, for git apply",
      ),
      Flag.withDefault(false),
    ),
    diff: Flag.Boolean("diff").pipe(
      Flag.withDescription("Also show each file to refresh or review against today's template"),
      Flag.withDefault(false),
    ),
    verbose: Flag.Boolean("verbose").pipe(
      Flag.withDescription("List every pin and file, not only what needs doing"),
      Flag.withDefault(false),
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
  (input) =>
    Effect.gen(function* () {
      const dir = resolve(input.cwd)
      if (!input.check) return yield* new UpgradeNeedsCheck()
      const manifest = yield* readManifest(dir)
      const addons = yield* loadAddons(yield* TemplatesDir)
      const r = yield* checkUpgrade(dir, manifest, addons, { diff: input.diff })
      if (input.json) {
        yield* printSuccess({
          check: true,
          directory: r.directory,
          stack: r.stack,
          efforgeVersion: {
            project: r.project.efforgeVersion,
            cli: r.project.cli,
            status: r.project.status,
          },
          drifted: r.drifted,
          pins: r.pins,
          sets: r.sets,
          guards: r.guards,
          files: r.files,
          seams: r.seams,
          scripts: r.scripts,
          steps: r.steps,
          warnings: r.warnings,
          ...(input.patch ? { patch: r.patch } : {}),
        })
      } else if (input.patch) {
        // only the patch, so `| git apply` reads nothing else
        if (r.patch !== "") yield* Console.log(r.patch.trimEnd())
      } else {
        // in a pipe, stdout carries only the report (docs/json.md, "In a pipe")
        if (process.stdout.isTTY)
          yield* Console.log(introLine(`upgrade --check  ${relative(process.cwd(), dir) || "."}`))
        yield* Console.log(renderUpgrade(r, input.verbose, input.diff))
      }
      if (r.drifted)
        yield* Effect.sync(() => {
          process.exitCode = FOUND
        })
    }).pipe(
      Effect.catch((e) =>
        Effect.gen(function* () {
          const args = yield* Invocation
          yield* report(input.json, upgradeFailure(e as never, args))
        }),
      ),
    ),
).pipe(
  Command.withDescription(
    "Show how this project differs from what this efforge generates, and what to do (--check)",
  ),
  Command.withExamples([
    { command: "npx create-efforge upgrade --check", description: "What differs, and what to do" },
    {
      command: "npx create-efforge upgrade --check --diff",
      description: "Also show each file's diff",
    },
    {
      command: "npx create-efforge upgrade --check --json",
      description: "The same as data; exit code 2 when something differs",
    },
  ]),
)
