import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { expect, it, vi } from "vitest"
import { addCommands, pageName, pagesDir, readAddons, root } from "../scripts/docs/addons.ts"
import { runWith } from "../src/cli.ts"
import { scriptedPromptIO } from "../src/prompts/navigable.ts"
import type { SlotId } from "../src/stack.ts"
import { toCommand } from "../src/stack.ts"
import { recordingSpawner } from "./recordingSpawner.ts"

// Every "Add it" command on an add-on page runs, with --dry-run, against the project it is for: a
// project made without the add-on. Only child processes (pnpm, git) are stubbed.

const cli = async (args: ReadonlyArray<string>) => {
  const out: string[] = []
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "))
  })
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "))
  })
  process.exitCode = undefined
  try {
    await runWith([...args]).pipe(
      Effect.provide(
        Layer.mergeAll(NodeServices.layer, scriptedPromptIO([]).layer, recordingSpawner([])),
      ),
      Effect.runPromise,
    )
  } finally {
    vi.restoreAllMocks()
  }
  const code = process.exitCode ?? 0
  process.exitCode = undefined
  return { code, out: out.join("\n") }
}

const ids = [...(await readAddons()).keys()].filter((id) => id !== "base")

it.each(ids)("every Add it command on %s's page runs", { timeout: 120_000 }, async (id) => {
  const [slot, option] = id.split("/") as [SlotId, string]
  const page = readFileSync(join(root, pagesDir, pageName(id)), "utf8")
  const section = page.slice(page.indexOf("## Add it"), page.indexOf("## Needs"))
  const shown = [...section.matchAll(/^npx create-efforge add .*$/gm)].map((m) => m[0])
  const commands = addCommands(slot, option)
  expect(shown).toEqual(commands.map((c) => `npx create-efforge add ${c.ids.join(" ")}`))

  const work = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "efforge-docs-add-"))
  const before = process.cwd()
  process.chdir(work)
  try {
    for (const [i, c] of commands.entries()) {
      const dir = join(work, `p${i}`)
      // toCommand: `npx -y create-efforge create <name> --yes ...`
      const create = toCommand({ ...c.from, name: `p${i}` })
        .split(" ")
        .slice(3)
      const made = await cli([...create, "--no-install", "--no-git"])
      expect(made.code, made.out).toBe(0)
      const added = await cli(["add", ...c.ids, "--dry-run", "--no-install", "--cwd", dir])
      expect(added.code, `add ${c.ids.join(" ")} on ${toCommand(c.from)}\n${added.out}`).toBe(0)
    }
  } finally {
    process.chdir(before)
    rmSync(work, { recursive: true, force: true })
  }
})
