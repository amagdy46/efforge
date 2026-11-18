import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it } from "vitest"
import { installOwed } from "../src/installed.ts"

// Whether an install is owed is read from the project: what package.json files and
// pnpm-workspace.yaml declare against pnpm's record of what it installed. No marker to go stale.

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "efforge-installed-"))
  writeFileSync(
    join(dir, "pnpm-workspace.yaml"),
    'packages:\n  - packages/*\noverrides:\n  vite: "catalog:"\n  effect@>=4.0.0-0: 4.1.4\ncatalog:\n  vite: 8.3.8\n  effect: 4.1.4\n',
  )
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ devDependencies: { vite: "catalog:" } }),
  )
  mkdirSync(join(dir, "packages/core"), { recursive: true })
  writeFileSync(
    join(dir, "packages/core/package.json"),
    JSON.stringify({ dependencies: { effect: "catalog:", "@repo/db": "workspace:*" } }),
  )
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** What pnpm 12 writes after installing the project above (the parts that matter). */
const installed = (extra = "") => {
  mkdirSync(join(dir, "node_modules/.pnpm"), { recursive: true })
  writeFileSync(join(dir, "node_modules/.modules.yaml"), "layoutVersion: 5\n")
  writeFileSync(
    join(dir, "node_modules/.pnpm/lock.yaml"),
    `lockfileVersion: '9.0'

catalogs:
  default:
    vite:
      specifier: 8.3.8
      version: 8.3.8

overrides:
  vite: 8.3.8
  effect@>=4.0.0-0: 4.1.4

importers:

  .:
    devDependencies:
      vite:
        specifier: 8.3.8
        version: 8.3.8

  packages/core:
    dependencies:
      '@repo/db':
        specifier: workspace:*
        version: link:../db
      effect:
        specifier: 4.1.4
        version: 4.1.4
${extra}
packages:

  effect@4.1.4:
    resolution: {integrity: sha512-x}
`,
  )
}

it("an install that matches the manifests owes nothing", () => {
  installed()
  expect(installOwed(dir)).toBe(false)
})

it("a dependency declared after the install is owed, and the install settles it", () => {
  installed()
  writeFileSync(
    join(dir, "packages/core/package.json"),
    JSON.stringify({
      dependencies: { effect: "catalog:", "@repo/db": "workspace:*", resend: "6.0.0" },
    }),
  )
  expect(installOwed(dir)).toBe(true)
  installed(`      resend:
        specifier: 6.0.0
        version: 6.0.0
`)
  expect(installOwed(dir)).toBe(false)
})

it("a changed catalog version or override is owed", () => {
  installed()
  writeFileSync(
    join(dir, "pnpm-workspace.yaml"),
    'packages:\n  - packages/*\noverrides:\n  vite: "catalog:"\n  effect@>=4.0.0-0: 4.1.5\ncatalog:\n  vite: 8.3.8\n  effect: 4.1.5\n',
  )
  expect(installOwed(dir)).toBe(true)
})

it("a script-only change owes nothing: there is nothing to install", () => {
  installed()
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ scripts: { dev: "vite" }, devDependencies: { vite: "catalog:" } }),
  )
  expect(installOwed(dir)).toBe(false)
})

it("no install at all is not 'owed' (that is `installed: false`)", () => {
  expect(installOwed(dir)).toBe(false)
})

it("without pnpm's record, a manifest newer than the install is the sign", () => {
  mkdirSync(join(dir, "node_modules"))
  writeFileSync(join(dir, "node_modules/.modules.yaml"), "")
  const t = Date.now() / 1000
  utimesSync(join(dir, "node_modules/.modules.yaml"), t, t)
  for (const f of ["package.json", "packages/core/package.json", "pnpm-workspace.yaml"])
    utimesSync(join(dir, f), t - 10, t - 10)
  expect(installOwed(dir)).toBe(false)
  utimesSync(join(dir, "packages/core/package.json"), t + 10, t + 10)
  expect(installOwed(dir)).toBe(true)
})

it("a leftover marker from an earlier version changes nothing", () => {
  installed()
  mkdirSync(join(dir, "node_modules/.efforge-install-pending"))
  expect(installOwed(dir)).toBe(false)
})
