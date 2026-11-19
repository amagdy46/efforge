import { readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { Console, Effect } from "effect"
import { Command, Flag } from "effect/cli"
import pc from "picocolors"
import { loadAddons } from "../addon.ts"
import { Invocation, printSuccess, report } from "../contract.ts"
import { type CheckResult, DoctorProbe, doctorContext, overall, runChecks } from "../doctor.ts"
import { introLine } from "../intro.ts"
import { addFailure, readManifest } from "./add.ts"
import { TemplatesDir } from "./create.ts"
import { FOUND } from "./upgrade.ts"

const mark: Record<CheckResult["status"], string> = {
  ok: pc.green("✓"),
  warn: pc.yellow("!"),
  fail: pc.red("✗"),
  skipped: pc.dim("-"),
  unverified: pc.yellow("?"),
}

/** One line per check, with the fix under anything that isn't ok. */
export const renderDoctor = (results: ReadonlyArray<CheckResult>): string => {
  const width = Math.max(...results.map((r) => r.id.length))
  const lines: string[] = []
  for (const r of results) {
    const text =
      r.status === "skipped"
        ? pc.dim(`skipped: ${r.message}`)
        : r.status === "unverified"
          ? `could not verify: ${r.message}`
          : r.message
    lines.push(`${mark[r.status]} ${r.id.padEnd(width)}  ${text}`)
    if (r.fix !== null && r.status !== "ok")
      lines.push(`  ${" ".repeat(width)}  ${pc.dim("Try:")} ${r.fix}`)
  }
  const n = (s: CheckResult["status"]) => results.filter((r) => r.status === s).length
  const tally = [
    n("fail") > 0 ? pc.red(`${n("fail")} failed`) : undefined,
    n("warn") > 0
      ? pc.yellow(`${n("warn")} ${n("warn") === 1 ? "warning" : "warnings"}`)
      : undefined,
    `${n("ok")} ok`,
    n("unverified") > 0 ? pc.yellow(`${n("unverified")} not verified`) : undefined,
    n("skipped") > 0 ? `${n("skipped")} skipped` : undefined,
  ].filter((x) => x !== undefined)
  lines.push("", `${tally.join(", ")}.`)
  return lines.join("\n")
}

/** `engines.node` of the projects this efforge generates. */
const enginesOf = (templates: string): string => {
  try {
    const pkg = JSON.parse(readFileSync(join(templates, "base/files/root/package.json"), "utf8"))
    return String(pkg.engines?.node ?? "*")
  } catch {
    return "*"
  }
}

export const doctorCommand = Command.make(
  "doctor",
  {
    online: Flag.Boolean("online").pipe(
      Flag.withDescription(
        "Also run checks that may use the network (peers under another pnpm, a remote database)",
      ),
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
      // a missing or unreadable efforge.jsonc is an error; an invalid one is a failed check
      const manifest = yield* readManifest(dir).pipe(
        Effect.map((m) => ({ m, problem: undefined as string | undefined })),
        Effect.catchTag("NotAnEfforgeProject", (e) =>
          e.reason.startsWith("efforge.jsonc is not")
            ? Effect.succeed({ m: undefined, problem: e.reason })
            : Effect.fail(e),
        ),
      )
      const templates = yield* TemplatesDir
      const all = yield* loadAddons(templates)
      const ctx = doctorContext({
        dir,
        manifest: manifest.m,
        manifestProblem: manifest.problem,
        all,
        online: input.online,
        json: input.json,
        probe: yield* DoctorProbe,
        engines: enginesOf(templates),
      })
      const results = yield* runChecks(ctx)
      const status = overall(results)
      if (input.json)
        yield* printSuccess({
          directory: dir,
          ...(manifest.m === undefined ? {} : { stack: manifest.m.stack }),
          status,
          checks: results,
        })
      else {
        if (process.stdout.isTTY)
          yield* Console.log(introLine(`doctor  ${relative(process.cwd(), dir) || "."}`))
        yield* Console.log(renderDoctor(results))
      }
      if (status === "fail")
        yield* Effect.sync(() => {
          process.exitCode = FOUND
        })
    }).pipe(
      Effect.catch((e) =>
        Effect.gen(function* () {
          const args = yield* Invocation
          yield* report(input.json, addFailure(e as never, args))
        }),
      ),
    ),
).pipe(
  Command.withDescription("Check this project's checkout and say what is wrong and how to fix it"),
  Command.withExamples([
    { command: "npx create-efforge doctor", description: "Every check, one line each" },
    {
      command: "npx create-efforge doctor --json",
      description: "The checks as data; exit code 2 when one fails",
    },
  ]),
)
