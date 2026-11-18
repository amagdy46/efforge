import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Path } from "effect"
import { expect, it } from "vitest"
import { addonPages, pagesDir, readAddons, root } from "../scripts/docs/addons.ts"
import { repo } from "../scripts/brand/source.ts"
import { diagramFiles } from "../scripts/docs/diagram.ts"
import { generate } from "../src/generate.ts"
import { withDefaults } from "../src/stack.ts"

const read = (p: string) => readFileSync(join(root, p), "utf8")

it("every add-on page matches its manifest (run pnpm docs:addons)", async () => {
  const pages = addonPages(await readAddons())
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
}, 30_000)

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
      for (const error of service.errors)
        expect(text, `${manifest.id}: ${f.path}`).toContain(`TaggedError("${error}")`)
    }
    expect(
      manifest.transforms.some((t) => t.name === "addLayer"),
      `${manifest.id} names a service but adds no layer`,
    ).toBe(true)
  }
})

const markdown = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? markdown(join(dir, e.name))
      : e.name.endsWith(".md")
        ? [join(dir, e.name)]
        : [],
  )

it("relative links in docs/ and the repo templates resolve", () => {
  const files = [
    ...markdown("docs").filter((f) => !f.startsWith("docs/plans")),
    "SECURITY.md",
    ".github/pull_request_template.md",
  ]
  const broken: string[] = []
  for (const file of files) {
    const text = read(file).replace(/```[\s\S]*?```/g, "")
    for (const m of text.matchAll(/\]\(([^)\s]+)\)|(?:src|srcset)="([^"]+)"/g)) {
      const target = m[1] ?? m[2]
      if (target === undefined || /^(mailto:|#)/.test(target)) continue
      // images served from the repo's main branch (the <picture> sources) must be committed files
      if (target.startsWith(`${repo.raw}/`)) {
        if (!existsSync(join(root, target.slice(repo.raw.length + 1))))
          broken.push(`${file}: ${target}`)
        continue
      }
      if (/^https?:/.test(target)) continue
      const path = join(dirname(file), target.split("#")[0] as string)
      if (!existsSync(join(root, path))) broken.push(`${file}: ${target}`)
    }
  }
  expect(broken).toEqual([])
})

/** The project the docs quote: the default stack with extras=email, as `generate` writes it. */
const referenceProject = async () => {
  const addons = await readAddons()
  return Effect.runPromise(
    generate(withDefaults({ name: "my-app", extras: ["email"] }), addons).pipe(
      Effect.provide(NodeFileSystem.layer),
      Effect.provide(Path.layer),
    ),
  )
}

it("every code sample in docs/ is a contiguous excerpt of the file it names", async () => {
  // A sample is a fenced block right after `<!-- sample: <path> -->`. The path is a file of the
  // reference project, or of this repo when it starts with `repo:`.
  const project = await referenceProject()
  const problems: string[] = []
  let count = 0
  for (const file of markdown("docs")) {
    for (const m of read(file).matchAll(/<!-- sample: (\S+) -->\n+```\w*\n([\s\S]*?)```/g)) {
      count++
      const [, source = "", body = ""] = m
      const text = source.startsWith("repo:")
        ? existsSync(join(root, source.slice(5)))
          ? read(source.slice(5))
          : undefined
        : project.get(source)
      if (text === undefined) problems.push(`${file}: ${source} does not exist`)
      else if (!`\n${text}`.includes(`\n${body}`))
        problems.push(`${file}: not in ${source}:\n${body}`)
    }
  }
  expect(problems).toEqual([])
  expect(count).toBeGreaterThan(0)
})
