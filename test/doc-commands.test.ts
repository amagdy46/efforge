import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { expect, it, vi } from "vitest"
import { runWith } from "../src/cli.ts"
import { scriptedPromptIO } from "../src/prompts/navigable.ts"
import { recordingSpawner } from "./recordingSpawner.ts"

// The documents an agent learns efforge from must not teach a command that fails. Every
// `create-efforge` command in their shell blocks runs here, in order, in a fresh directory, with
// the real templates; only child processes (pnpm, git) are stubbed.

const root = new URL("..", import.meta.url).pathname

/** The section of README.md that agents are pointed at. */
const readmeSection = () => {
  const text = readFileSync(join(root, "README.md"), "utf8")
  const start = text.indexOf("## For coding agents")
  expect(start).toBeGreaterThan(0)
  const end = text.indexOf("\n## ", start + 1)
  return text.slice(start, end === -1 ? undefined : end)
}

const sources: Record<string, () => string> = {
  "skills/efforge/SKILL.md": () => readFileSync(join(root, "skills/efforge/SKILL.md"), "utf8"),
  "llms.txt": () => readFileSync(join(root, "llms.txt"), "utf8"),
  "README.md (For coding agents)": readmeSection,
}

/** `create-efforge` command lines inside ```sh blocks. */
const commands = (text: string): string[] =>
  [...text.matchAll(/```sh\n([\s\S]*?)```/g)]
    .flatMap((m) => (m[1] as string).split("\n"))
    .map((l) => l.trim())
    .filter((l) => /\bcreate-efforge\b/.test(l))

/** `npx -y create-efforge@latest create ...` -> `["create", ...]`. */
const argsOf = (line: string): string[] => {
  const tokens = line.split(/\s+/)
  expect(tokens[0], line).toBe("npx")
  let i = 1
  while (tokens[i] === "-y" || tokens[i] === "--yes") i++
  expect(tokens[i], line).toMatch(/^create-efforge(@latest)?$/)
  return tokens.slice(i + 1)
}

it.each(Object.keys(sources))("every command in %s runs", { timeout: 120_000 }, async (name) => {
  const lines = commands((sources[name] as () => string)())
  expect(lines.length).toBeGreaterThan(0)
  const work = mkdtempSync(join(tmpdir(), "efforge-doc-commands-"))
  const before = process.cwd()
  process.chdir(work)
  try {
    for (const line of lines) {
      const stdout: string[] = []
      vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
        stdout.push(a.join(" "))
      })
      vi.spyOn(console, "error").mockImplementation(() => {})
      process.exitCode = undefined
      await runWith(argsOf(line)).pipe(
        Effect.provide(
          Layer.mergeAll(NodeServices.layer, scriptedPromptIO([]).layer, recordingSpawner([])),
        ),
        Effect.runPromise,
      )
      vi.restoreAllMocks()
      expect(process.exitCode ?? 0, `${line}\n${stdout.join("\n")}`).toBe(0)
      if (line.includes("--json")) expect(JSON.parse(stdout.join("\n")).ok, line).toBe(true)
    }
  } finally {
    process.chdir(before)
    process.exitCode = undefined
    rmSync(work, { recursive: true, force: true })
  }
})
