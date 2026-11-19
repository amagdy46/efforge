import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Path } from "effect"
import { expect, it } from "vitest"
import { repo } from "../scripts/brand/source.ts"
import {
  addonPages,
  escapeMarkdown,
  pagesDir,
  readAddons,
  root,
  serviceMembers,
} from "../scripts/docs/addons.ts"
import { diagramFiles, diagramText } from "../scripts/docs/diagram.ts"
import { generate } from "../src/generate.ts"
import { withDefaults } from "../src/stack.ts"
import { versions } from "../src/versions.ts"

const read = (p: string) => readFileSync(join(root, p), "utf8")

it("every add-on page matches its manifest (run pnpm docs:addons)", async () => {
  const pages = await addonPages(await readAddons())
  const stale = [...pages].filter(
    ([path, body]) => !existsSync(join(root, path)) || read(path) !== body,
  )
  const extra = readdirSync(join(root, pagesDir)).filter((f) => !pages.has(`${pagesDir}/${f}`))
  expect({ stale: stale.map(([p]) => p), extra }, "run pnpm docs:addons").toEqual({
    stale: [],
    extra: [],
  })
})

it("the architecture diagram matches the brand palette and fonts (run pnpm docs:diagram)", () => {
  const stale = [...diagramFiles()].filter(
    ([path, body]) => !existsSync(join(root, path)) || read(path) !== body,
  )
  expect(
    stale.map(([p]) => p),
    "run pnpm docs:diagram",
  ).toEqual([])
  const assets = readdirSync(join(root, "docs/assets")).filter((f) => f.startsWith("layers-"))
  expect(assets.map((f) => `docs/assets/${f}`).toSorted()).toEqual(
    [...diagramFiles().keys()].toSorted(),
  )
}, 30_000)

it("the diagram's labels are all in the text list under it", () => {
  const page = read("docs/architecture.md")
  const list = page.slice(page.indexOf("The same facts as text:"), page.indexOf("## 1."))
  for (const label of [...diagramText.steps, ...diagramText.names, ...diagramText.files])
    expect(list, "run pnpm docs:diagram, then name every label in the list").toContain(label)
})

it("the diagram's <picture> has two sources, light and dark, as GitHub expects", () => {
  // GitHub rewrites a dark-theme <source> media query and drops anything else in it (such as a
  // max-width), so a picture with more sources shows the wrong one: keep the README header's shape
  const picture = /<picture>([\s\S]*?)<\/picture>/.exec(read("docs/architecture.md"))?.[1] ?? ""
  const sources = [...picture.matchAll(/<source media="([^"]+)" srcset="([^"]+)">/g)]
  expect(sources.map((m) => m[1])).toEqual(["(prefers-color-scheme: dark)"])
  expect(sources[0]?.[2]).toBe(`${repo.raw}/docs/assets/layers-dark.svg`)
  expect(picture).toContain(`<img src="${repo.raw}/docs/assets/layers-light.svg" width="520"`)
})

it("each guide's service is declared, with those tagged errors, in the file it names", async () => {
  for (const { manifest, dir } of (await readAddons()).values()) {
    const service = manifest.guide?.service
    if (service === undefined) continue
    const sources = manifest.files.filter((f) => f.target === service.file)
    expect(sources.length, `${manifest.id}: no file targets ${service.file}`).toBeGreaterThan(0)
    for (const f of sources) {
      const text = readFileSync(join(dir, f.path), "utf8")
      expect(text, `${manifest.id}: ${f.path}`).toMatch(
        new RegExp(`class ${service.name} extends Context\\.Service<`),
      )
      expect(serviceMembers(text, service.name).length, `${manifest.id}: members`).toBeGreaterThan(
        0,
      )
      for (const error of service.errors)
        expect(text, `${manifest.id}: ${f.path}`).toContain(`TaggedError("${error}")`)
    }
    expect(
      manifest.transforms.some((t) => t.name === "addLayer"),
      `${manifest.id} names a service but adds no layer`,
    ).toBe(true)
  }
})

it("serviceMembers reads methods, values and their tagged errors from a service's declaration", () => {
  const text = `export class Jobs extends Context.Service<
  Jobs,
  {
    /** Starts a job. */
    readonly start: (job: string, payload?: unknown) => Effect.Effect<Run, JobError | Busy>
    readonly current: Effect.Effect<Run, never>
    readonly db: Client
  }
>()("@repo/core/Jobs") {}`
  expect(serviceMembers(text, "Jobs")).toEqual([
    { signature: "start(job, payload?)", errors: ["JobError", "Busy"], doc: "Starts a job." },
    { signature: "current", errors: [], doc: undefined },
    { signature: "db", errors: [], doc: undefined },
  ])
})

it("a guide's limits name no pinned version (the Dependencies table has them)", async () => {
  const pinned = new Set(Object.values(versions).filter((v) => typeof v === "string"))
  for (const { manifest } of (await readAddons()).values())
    for (const limit of manifest.guide?.limits ?? [])
      for (const v of pinned) expect(limit, `${manifest.id}: ${v}`).not.toContain(v)
})

/** `text` with code spans, fenced blocks and HTML comments removed. */
const prose = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/`[^`\n]*`/g, "")

it("escapeMarkdown escapes angle brackets outside code only", () => {
  expect(escapeMarkdown("run wrangler email sending enable <domain>.")).toBe(
    "run wrangler email sending enable &lt;domain&gt;.",
  )
  expect(escapeMarkdown("run `enable <domain>` then <b>")).toBe(
    "run `enable <domain>` then &lt;b&gt;",
  )
  expect(escapeMarkdown("```sh\na <b>\n```")).toBe("```sh\na <b>\n```")
})

it("no add-on page has an angle bracket GitHub would read as a tag", async () => {
  const pages = await addonPages(await readAddons())
  const raw = [...pages].filter(([, body]) => /<[a-zA-Z/]/.test(prose(body))).map(([p]) => p)
  expect(raw).toEqual([])
})

const markdown = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? markdown(join(dir, e.name))
      : e.name.endsWith(".md")
        ? [join(dir, e.name)]
        : [],
  )

/** GitHub's anchor for a heading. */
const slug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^\w\- ]/g, "")
    .replace(/ /g, "-")

const anchors = (file: string) =>
  new Set(
    [
      ...read(file)
        .replace(/```[\s\S]*?```/g, "")
        .matchAll(/^#{1,6} (.+)$/gm),
    ].map((m) => slug(m[1] as string)),
  )

it("relative links in docs/ resolve, anchors included", () => {
  const files = [...markdown("docs").filter((f) => !f.startsWith("docs/plans")), "SECURITY.md"]
  const broken: string[] = []
  for (const file of files) {
    const text = read(file).replace(/```[\s\S]*?```/g, "")
    for (const m of text.matchAll(/\]\(([^)\s]+)\)|(?:src|srcset)="([^"]+)"/g)) {
      const target = m[1] ?? m[2]
      if (target === undefined || target.startsWith("mailto:")) continue
      // images served from the repo's main branch (the <picture> sources) must be committed files
      if (target.startsWith(`${repo.raw}/`)) {
        if (!existsSync(join(root, target.slice(repo.raw.length + 1))))
          broken.push(`${file}: ${target}`)
        continue
      }
      if (/^https?:/.test(target)) continue
      const [path = "", anchor] = target.split("#")
      const linked = path === "" ? file : join(dirname(file), path)
      if (!existsSync(join(root, linked))) broken.push(`${file}: ${target}`)
      else if (anchor !== undefined && linked.endsWith(".md") && !anchors(linked).has(anchor))
        broken.push(`${file}: ${target} (no such heading)`)
    }
  }
  expect(broken).toEqual([])
})

it("the pull request template links with a full URL (GitHub does not resolve relative ones there)", () => {
  const text = read(".github/pull_request_template.md")
  expect(text).not.toMatch(/\]\((?!https:\/\/)[^)]+\)/)
})

/** The project the docs quote: the default stack, as `generate` writes it. */
const referenceProject = async () => {
  const addons = await readAddons()
  return Effect.runPromise(
    generate(withDefaults({ name: "my-app" }), addons).pipe(
      Effect.provide(NodeFileSystem.layer),
      Effect.provide(Path.layer),
    ),
  )
}
const project = await referenceProject()

/** A file of the reference project, or of this repo when the path starts with `repo:`. */
const source = (path: string): string | undefined =>
  path.startsWith("repo:")
    ? existsSync(join(root, path.slice(5)))
      ? read(path.slice(5))
      : undefined
    : project.get(path)

it("every code sample in docs/ is a contiguous excerpt of the file it names", () => {
  // A sample is a fenced block right after `<!-- sample: <path> -->`.
  const problems: string[] = []
  let count = 0
  for (const file of markdown("docs")) {
    for (const m of read(file).matchAll(/<!-- sample: (\S+) -->\n+```\w*\n([\s\S]*?)```/g)) {
      count++
      const [, path = "", body = ""] = m
      const text = source(path)
      if (text === undefined) problems.push(`${file}: ${path} does not exist`)
      else if (!`\n${text}`.includes(`\n${body}`))
        problems.push(`${file}: not in ${path}:\n${body}`)
    }
  }
  expect(problems).toEqual([])
  expect(count).toBeGreaterThan(0)
})

/** True when `quote` is in `text`, or matches one of its `{{placeholder}}` message templates. */
const quoted = (text: string, quote: string) =>
  text.includes(quote) ||
  [...text.matchAll(/"([^"\n]*\{\{\w+\}\}[^"\n]*)"/g)].some((m) =>
    new RegExp(
      (m[1] as string)
        .split(/\{\{\w+\}\}/)
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".+"),
    ).test(quote),
  )

it("every quoted message in docs/ is in the file it names", () => {
  // `<!-- quote: <path> -->` before a paragraph: each "..." in it; before a fenced block: each
  // line's message after `rule(id): `, and the rule id itself.
  const problems: string[] = []
  let count = 0
  for (const file of markdown("docs")) {
    for (const m of read(file).matchAll(/<!-- quote: (\S+) -->\n\s*([\s\S]*?)(?:\n\s*\n|$)/g)) {
      const [, path = "", block = ""] = m
      const text = source(path)
      if (text === undefined) {
        problems.push(`${file}: ${path} does not exist`)
        continue
      }
      const fence = /^```\w*\n([\s\S]*?)\n\s*```/.exec(block)
      const quotes = fence
        ? (fence[1] as string).split("\n").flatMap((line) => {
            const rule = /\(([\w-]+)\): (.*)$/.exec(line.trim())
            return rule === null ? [line.trim()] : [`"${rule[1]}"`, rule[2] as string]
          })
        : [...block.matchAll(/"([^"]+)"/g)].map((q) => q[1] as string)
      for (const q of quotes) {
        count++
        if (!quoted(text, q)) problems.push(`${file}: "${q}" is not in ${path}`)
      }
    }
  }
  expect(problems).toEqual([])
  expect(count).toBeGreaterThan(2)
})

it("every lint rule docs/ names is configured in the reference project", () => {
  const config = `${project.get("vite.config.ts")}\n${project.get("lint/effect-tests.js")}`
  // decisions and plans record history, so they may name rules the project no longer has
  const pages = markdown("docs").filter((f) => !/^docs\/(decisions|plans)\//.test(f))
  const rules = pages.flatMap((f) =>
    [...read(f).matchAll(/\b(effecttsgo|effect-tests)\(([\w-]+)\)/g)].map((m) => ({
      file: f,
      rule: `${m[1]}/${m[2]}`,
      id: m[2] as string,
    })),
  )
  expect(rules.length).toBeGreaterThan(0)
  for (const r of rules)
    expect(config.includes(r.rule) || config.includes(`"${r.id}"`), `${r.file}: ${r.rule}`).toBe(
      true,
    )
})

it("every path in a <!-- paths --> block exists in the reference project, with the names beside it", () => {
  // Each line: a step, a path, then what happens there. The names in that last part (camelCase,
  // PascalCase or CAPS, such as listNotes, NotesLive, HYPERDRIVE) must appear in the file.
  const problems: string[] = []
  let count = 0
  for (const file of markdown("docs"))
    for (const m of read(file).matchAll(/<!-- paths -->\n+```\w*\n([\s\S]*?)```/g))
      for (const line of (m[1] as string).split("\n")) {
        const hit = /\s((?:apps|packages)\/\S+)\s+(.*)$/.exec(line)
        if (hit === null) continue
        count++
        const [, path = "", what = ""] = hit
        const text = project.get(path)
        if (text === undefined) {
          problems.push(`${file}: ${path} does not exist`)
          continue
        }
        for (const name of what.match(/\b[a-z]+[A-Z]\w*|\b[A-Z][a-z]+[A-Z]\w*|\b[A-Z]{3,}\b/g) ??
          [])
          if (!text.includes(name)) problems.push(`${file}: ${name} is not in ${path}`)
      }
  expect(problems).toEqual([])
  expect(count).toBeGreaterThan(3)
})
