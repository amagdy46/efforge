// `pnpm docs:addons`: writes docs/addons/<slot>-<option>.md and docs/addons/README.md from the
// add-on manifests (templates/<slot>/<option>/addon.json), versions.ts and slots.ts. The prose comes
// from each manifest's `guide`. test/docs.test.ts fails while a page is stale.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Path } from "effect"
import { type AddonManifest, type LoadedAddon, loadAddons, type When } from "../../src/addon.ts"
import { slots, whyUnavailable } from "../../src/slots.ts"
import type { SlotId, StackConfig } from "../../src/stack.ts"
import { transformTargets } from "../../src/transforms/index.ts"
import { versions } from "../../src/versions.ts"

export const root = fileURLToPath(new URL("../..", import.meta.url))
export const pagesDir = "docs/addons"

/** Every add-on but `base`, which is the project itself. */
export const readAddons = (): Promise<ReadonlyMap<string, LoadedAddon>> =>
  Effect.runPromise(
    loadAddons(join(root, "templates")).pipe(
      Effect.provide(NodeFileSystem.layer),
      Effect.provide(Path.layer),
    ),
  )

/** `extras/email` -> `extras-email.md` */
export const pageName = (id: string) => `${id.replace("/", "-")}.md`

const code = (s: string) => (s.includes("`") ? `\`\` ${s} \`\`` : `\`${s}\``)

const whenText = (when: When | undefined) =>
  when === undefined
    ? ""
    : Object.entries(when)
        .map(([slot, values]) => values.map((v) => code(`${slot}=${v}`)).join(" or "))
        .join(" and ")

const onlyWhen = (when: When | undefined) =>
  when === undefined ? "" : ` Only with ${whenText(when)}.`

const describe = (t: AddonManifest["transforms"][number]): string => {
  const a = t.args
  switch (t.name) {
    case "addImport":
      return `Imports ${code(a.import ?? "")} from ${code(a.from ?? "")}.`
    case "addExport":
      return a.export === "*"
        ? `Re-exports everything from ${code(a.from ?? "")}.`
        : `Exports ${code(a.export ?? "")} from ${code(a.from ?? "")}.`
    case "addLayer":
      return `Adds ${code(a.layer ?? "")} to ${code("AppLayer")}, imported from ${code(a.from ?? "")}.`
    case "addArrayItem":
      return `Adds ${code(a.item ?? "")} to ${code(a.name ?? "")}.`
    case "addServerFnMiddleware":
      return `Runs ${code(a.middleware ?? "")} before every server function in the file.`
    case "addAuthPlugin":
      return a.mergeInto === undefined
        ? `Adds the ${code(a.call ?? "")} plugin to Better Auth.`
        : `Sets ${code(a.property ?? "")} in the options of the ${code(a.mergeInto)} plugin.`
    case "addWranglerBinding":
      return `Adds a ${code(a.key ?? "")} entry: ${code(a.value ?? "")}.`
    case "setWranglerValue":
      return `Sets ${code(a.key ?? "")} to ${code(a.value ?? "")}.`
    case "addAlchemyResource":
      return `Declares ${code(a.name ?? "")} and binds it to the Worker as ${code(a.binding ?? "")}.`
    case "addWorkflowSecret":
      return `Passes the ${code(a.name ?? "")} secret to the deploy job.`
    case "addDevVar":
      return `Sets ${code(`${a.name}=${a.value}`)} for local development.`
    case "appendAgentsSection":
      return "Adds the rules under [Rules it adds to AGENTS.md](#rules-it-adds-to-agentsmd)."
    default:
      throw new Error(`scripts/docs/addons.ts has no description for the transform "${t.name}"`)
  }
}

/** The compatibility rules from slots.ts, as sentences. */
const choices = (slot: SlotId) =>
  (slots.find((s) => s.id === slot)?.options ?? []).map((o) => o.id).filter((o) => o !== "none")

const needs = (slot: SlotId, option: string, m: AddonManifest): string[] => {
  const out: string[] = []
  const [database] = choices("database")
  const [orm, ...otherOrms] = choices("orm")
  const or = (s: SlotId, rest: string[]) => rest.map((o) => ` or \`${s}/${o}\``).join("")
  if (whyUnavailable(slot, option, { database: "none" }) !== undefined) {
    const with_ = slot === "orm" ? "" : ` orm/${orm}`
    out.push(
      `A database. On a project without one, add both in one command: \`npx create-efforge add database/${database}${with_} ${slot}/${option}\` (or another database${slot === "orm" ? "" : " and ORM"}).`,
    )
  }
  if (
    slot === "database" &&
    whyUnavailable("orm", "none", { database: option } as Partial<StackConfig>) !== undefined
  )
    out.push(
      `An ORM, added in the same command: \`npx create-efforge add database/${option} orm/${orm}\`${or("orm", otherOrms)}.`,
    )
  if (
    whyUnavailable(slot, option, { runtime: "other" } as unknown as Partial<StackConfig>) !==
    undefined
  )
    out.push("The Cloudflare runtime, which every project has today.")
  for (const id of m.requires) out.push(`[${id}](${pageName(id)}).`)
  return out
}

const commands = (slot: SlotId, option: string) => {
  const def = slots.find((s) => s.id === slot)
  if (def === undefined) throw new Error(`unknown slot ${slot}`)
  const flag = `--${slot}=${option}`
  if (def.options.length === 1)
    return [
      "Every project has it; there is nothing to choose.",
      "",
      "```sh",
      `npm create efforge my-app`,
      "```",
    ]
  const later = def.multi
    ? "Add it to an existing project:"
    : `Add it to an existing project whose \`${slot}\` is \`none\` (a single-choice slot only moves from \`none\` to a value):`
  return [
    "When you create the project:",
    "",
    "```sh",
    `npm create efforge my-app -- ${flag}`,
    "```",
    "",
    later,
    "",
    "```sh",
    `npx create-efforge add ${slot}/${option}`,
    "```",
  ]
}

const demote = (markdown: string) => markdown.replace(/^(#{1,5}) /gm, "#$1 ")

const page = (m: AddonManifest): string => {
  const [slot, option] = m.id.split("/") as [SlotId, string]
  const def = slots.find((s) => s.id === slot)
  const label = def?.options.find((o) => o.id === option)?.label ?? m.title
  const layer = m.transforms.find((t) => t.name === "addLayer")
  const agents = m.transforms.filter((t) => t.name === "appendAgentsSection")
  const lines: string[] = [
    `<!-- Generated by pnpm docs:addons from templates/${m.id}/addon.json. Do not edit: change the manifest and run pnpm docs:addons. -->`,
    "",
    `# ${m.title}`,
    "",
    m.description,
    "",
    `Id ${code(m.id)}: ${label}, in the ${def?.title ?? slot} slot. Template: [\`templates/${m.id}/\`](../../templates/${m.id}/).`,
    "",
    "## What it is for",
    "",
    m.guide?.purpose ?? m.description,
  ]

  lines.push("", "## Add it", "", ...commands(slot, option))

  const needed = needs(slot, option, m)
  lines.push("", "## Needs", "")
  lines.push(...(needed.length === 0 ? ["Nothing else."] : needed.map((n) => `- ${n}`)))
  lines.push("", "## Conflicts with", "")
  lines.push(
    ...(m.conflicts.length === 0
      ? ["Nothing."]
      : m.conflicts.map((id) => `- [${id}](${pageName(id)})`)),
  )

  lines.push("", "## Service and layer", "")
  const service = m.guide?.service
  if (service === undefined || layer === undefined)
    lines.push("None: this add-on adds no service of its own.")
  else {
    const errors =
      service.errors.length === 0
        ? ""
        : `, and it fails with ${service.errors.map(code).join(" or ")}`
    const layerName = layer.args.import ?? ""
    lines.push(
      `Your code asks for ${code(service.name)}, declared in ${code(service.file)}${errors}. ${code(layerName)} implements it, and \`efforge add\` puts it in \`AppLayer\` in \`apps/web/src/server/layers.ts\`.`,
      "",
      `- To test code that uses ${code(service.name)}, give it a test layer: ${code(`Layer.succeed(${service.name}, ${service.name}.of({ ... }))`)}. See [Swap a layer to test](../testing.md).`,
      `- To change the provider, write another layer for ${code(service.name)} and use it in \`layers.ts\` in place of ${code(layerName)}.`,
    )
    if (m.guide?.swap !== undefined) lines.push(`- ${m.guide.swap}`)
  }

  lines.push("", "## Files it adds", "")
  if (m.files.length === 0) lines.push("None.")
  else {
    const byTarget = new Map<string, Array<When | undefined>>()
    for (const f of m.files) byTarget.set(f.target, [...(byTarget.get(f.target) ?? []), f.when])
    lines.push("| File | Only with |", "| --- | --- |")
    for (const [target, whens] of byTarget) {
      const cond = whens.includes(undefined) ? "Always" : whens.map(whenText).join("; ")
      lines.push(`| ${code(target)} | ${cond} |`)
    }
  }

  lines.push("", "## Files it edits", "")
  lines.push(
    "`efforge add` makes these edits with AST transforms, so it changes only what is listed and leaves the rest of each file alone.",
  )
  const byFile = new Map<string, string[]>()
  const edit = (file: string, text: string) => byFile.set(file, [...(byFile.get(file) ?? []), text])
  for (const t of m.transforms) {
    const files = transformTargets(t)
    if (files.length === 0) throw new Error(`${m.id}: ${t.name} has no target file`)
    const text =
      t.name === "appendAgentsSection" ? describe(t) : `${describe(t)}${onlyWhen(t.when)}`
    for (const file of files) if (!(byFile.get(file) ?? []).includes(text)) edit(file, text)
  }
  const deps = [...Object.entries(m.dependencies), ...Object.entries(m.devDependencies)]
  if (deps.some(([, names]) => names.length > 0)) {
    const dirs = [...new Set(deps.filter(([, n]) => n.length > 0).map(([dir]) => dir))]
    for (const dir of dirs)
      edit(
        dir === "." ? "package.json" : `${dir}/package.json`,
        "Adds the dependencies listed below.",
      )
    edit("pnpm-workspace.yaml", "Pins the new dependencies in the `catalog`.")
  }
  for (const [dir, scripts] of Object.entries(m.scripts ?? {}))
    edit(
      dir === "." ? "package.json" : `${dir}/package.json`,
      `Sets the scripts ${Object.keys(scripts).map(code).join(", ")}; a script of the same name is replaced.`,
    )
  if (m.envVars.length > 0) edit(".env.example", "Adds the environment variables listed below.")
  edit("efforge.jsonc", "Records the add-on in the stack and the hashes of the files it wrote.")
  for (const [file, edits] of byFile) {
    lines.push("", `### ${code(file)}`, "")
    for (const e of edits) lines.push(`- ${e}`)
  }

  lines.push("", "## Dependencies", "")
  if (!deps.some(([, names]) => names.length > 0)) lines.push("None.")
  else {
    lines.push("| Package | Version | Workspace |", "| --- | --- | --- |")
    for (const [kind, record] of [
      ["", m.dependencies],
      [" (dev)", m.devDependencies],
    ] as const)
      for (const [dir, names] of Object.entries(record))
        for (const name of names) {
          const version = name.startsWith("@repo/") ? "workspace" : versions[name]
          if (version === undefined) throw new Error(`${m.id}: no version for ${name}`)
          lines.push(`| ${code(name)} | ${code(version)} | ${code(dir)}${kind} |`)
        }
  }

  lines.push("", "## Environment variables", "")
  if (m.envVars.length === 0) lines.push("None.")
  for (const v of m.envVars)
    lines.push(
      `- ${code(v.name)}, for example ${code(v.example)}: ${v.description.replace(/\.$/, "")}.${onlyWhen(v.when)}`,
    )

  lines.push("", "## Package scripts", "")
  const scripts = Object.entries(m.scripts ?? {})
  if (scripts.length === 0) lines.push("None.")
  for (const [dir, record] of scripts)
    for (const [name, command] of Object.entries(record))
      lines.push(
        `- ${code(name)} in ${code(dir === "." ? "package.json" : `${dir}/package.json`)}: ${code(command)}`,
      )

  lines.push("", "## Rules it adds to AGENTS.md", "")
  if (agents.length === 0) lines.push("None.")
  for (const t of agents) {
    if (t.when !== undefined) lines.push(`Only with ${whenText(t.when)}:`, "")
    lines.push(demote(t.args.content ?? ""), "")
  }
  if (agents.length > 0) lines.pop()

  lines.push("", "## Limits", "")
  const limits = m.guide?.limits ?? []
  if (limits.length === 0)
    lines.push("None known. The general ones are in [Status and limits](../limits.md).")
  for (const l of limits) lines.push(`- ${l}`)

  return `${lines.join("\n")}\n`
}

const index = (addons: ReadonlyArray<AddonManifest>): string => {
  const lines = [
    "<!-- Generated by pnpm docs:addons from templates/*/*/addon.json. Do not edit. -->",
    "",
    "# Add-ons",
    "",
    "Each add-on is one choice in one slot. Pick them when you create a project, or add them later with `npx create-efforge add <slot>/<option>`. Every page has the same headings: What it is for, Add it, Needs, Conflicts with, Service and layer, Files it adds, Files it edits, Dependencies, Environment variables, Package scripts, Rules it adds to AGENTS.md, Limits.",
    "",
    "`npx create-efforge list` prints the same list, and `list --json` prints it as JSON.",
  ]
  for (const slot of slots) {
    const inSlot = addons.filter((m) => m.id.startsWith(`${slot.id}/`))
    if (inSlot.length === 0) continue
    lines.push("", `## ${slot.title} (\`${slot.id}\`)`, "")
    for (const m of inSlot)
      lines.push(`- [${m.title}](${pageName(m.id)}) (\`${m.id}\`): ${m.description}`)
  }
  return `${lines.join("\n")}\n`
}

/** docs/addons path -> content, for every add-on but `base`. */
export const addonPages = (addons: ReadonlyMap<string, LoadedAddon>): Map<string, string> => {
  const manifests = [...addons.values()].map((a) => a.manifest).filter((m) => m.id !== "base")
  const out = new Map<string, string>()
  for (const m of manifests) out.set(`${pagesDir}/${pageName(m.id)}`, page(m))
  out.set(`${pagesDir}/README.md`, index(manifests))
  return out
}

if (import.meta.main) {
  const pages = addonPages(await readAddons())
  const dir = join(root, pagesDir)
  mkdirSync(dir, { recursive: true })
  let changed = 0
  for (const file of readdirSync(dir))
    if (!pages.has(`${pagesDir}/${file}`)) {
      rmSync(join(dir, file))
      console.log(`removed ${pagesDir}/${file}`)
      changed++
    }
  for (const [path, body] of pages) {
    const file = join(root, path)
    if (existsSync(file) && readFileSync(file, "utf8") === body) continue
    writeFileSync(file, body)
    console.log(`wrote ${path}`)
    changed++
  }
  console.log(changed === 0 ? "add-on pages are up to date" : `${changed} file(s) changed`)
}
