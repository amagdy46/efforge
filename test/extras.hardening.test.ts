import { copyFileSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect, Path } from "effect"
import { loadAddons } from "../src/addon.ts"
import { generate } from "../src/generate.ts"
import { withDefaults } from "../src/stack.ts"
import { versions } from "../src/versions.ts"

// The template sits next to a tsconfig that only resolves inside a generated project, so load a copy.
const policyCopy = join(mkdtempSync(join(tmpdir(), "url-policy-")), "url-policy.ts")
copyFileSync(
  new URL("../templates/extras/browser/files/app/src/url-policy.ts", import.meta.url),
  policyCopy,
)
const { checkUrl } = (await import(
  /* @vite-ignore */ policyCopy
)) as typeof import("../templates/extras/browser/files/app/src/url-policy.ts")

const templates = new URL("../templates", import.meta.url).pathname

const tree = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const config = withDefaults({
        name: "app",
        database: "none",
        orm: "none",
        auth: "none",
        infra: "none",
        ai: "none",
        extras: ["storage", "workflows", "realtime", "browser"],
      })
      return yield* generate(config, yield* loadAddons(templates))
    }).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Path.layer)),
  )

it("ships the pure helpers and their tests inside the generated project", async () => {
  const t = await tree()
  for (const file of [
    "packages/core/src/storage-security.ts",
    "packages/core/test/storage-security.test.ts",
    "packages/core/src/realtime-limits.ts",
    "packages/core/test/realtime-limits.test.ts",
    "apps/browser/src/url-policy.ts",
    "apps/browser/package-lock.json",
  ])
    expect(t.has(file), file).toBe(true)
})

it("apps/browser lockfile matches the exact pins and the Dockerfile uses it as pwuser", async () => {
  const t = await tree()
  const pkg = JSON.parse(t.get("apps/browser/package.json") as string)
  const lock = JSON.parse(t.get("apps/browser/package-lock.json") as string)
  // `npm ci` fails if these differ: regenerate with `npm install --package-lock-only` in a dir
  // holding the generated package.json, then copy package-lock.json into the template as
  // files/app/package-lock (npm pack always drops files named package-lock.json).
  expect(lock.packages[""].dependencies).toEqual(pkg.dependencies)
  expect(lock.packages[""].devDependencies).toEqual(pkg.devDependencies)
  for (const [name, version] of Object.entries(pkg.dependencies as Record<string, string>))
    expect(lock.packages[`node_modules/${name}`].version).toBe(version)
  expect(pkg.dependencies.playwright).toBe(versions.playwright)
  const docker = t.get("apps/browser/Dockerfile") as string
  expect(docker).toContain("npm ci --omit=dev")
  expect(docker).toContain("USER pwuser")
  expect(docker).toContain(`playwright:v${lock.packages["node_modules/playwright"].version}-`)
})

it("the template lockfile is plain JSON from the public registry", () => {
  const raw = readFileSync(
    new URL("../templates/extras/browser/files/app/package-lock", import.meta.url),
    "utf8",
  )
  expect(raw).not.toMatch(/"resolved": "(?!https:\/\/registry\.npmjs\.org\/)/)
})

it("server fns validate input with Schema, not a pass-through", async () => {
  const t = await tree()
  for (const file of ["run-browser", "example-job"]) {
    const src = t.get(`apps/web/src/server/${file}.ts`) as string
    expect(src).not.toMatch(/\.validator\(\(input/)
    expect(src).toContain("Schema.toStandardSchemaV1")
  }
})

it("the example workflow shows step retries and a typed, non-retryable failure", async () => {
  const src = (await tree()).get("apps/web/src/workflows/Example.ts") as string
  expect(src).toContain("retries:")
  expect(src).toContain("WorkflowStepNonRetryableError")
  expect(src).toContain("InvalidName")
})

// ---- browser URL policy
const allowed = (url: string) => checkUrl(url).ok

it("url policy allows public http(s) URLs", () => {
  for (const url of [
    "https://example.com/",
    "http://example.com:8080/a?b=c",
    "https://93.184.216.34/",
    "https://[2606:2800:220:1::1]/",
    "http://8.8.8.8",
    "http://172.32.0.1/",
    "http://100.63.0.1/",
  ])
    expect(allowed(url), url).toBe(true)
})

it("url policy rejects other schemes, credentials and unparsable input", () => {
  for (const url of [
    "",
    "not a url",
    "file:///etc/passwd",
    "ftp://example.com/",
    "javascript:alert(1)",
    "data:text/html,hi",
    "https://user:pw@example.com/",
  ])
    expect(allowed(url), url).toBe(false)
})

it("url policy blocks local names, private IPv4 and every spelling of them", () => {
  for (const url of [
    "http://localhost/",
    "http://LOCALHOST:3000/",
    "http://localhost./",
    "http://app.localhost/",
    "http://printer.local/",
    "http://db.internal/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://2130706433/",
    "http://0x7f.0.0.1/",
    "http://0177.0.0.1/",
    "http://0.0.0.0/",
    "http://10.0.0.5/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://198.18.0.1/",
    "http://224.0.0.1/",
    "http://255.255.255.255/",
  ])
    expect(allowed(url), url).toBe(false)
})

it("url policy blocks private, loopback, link-local and embedded-IPv4 IPv6", () => {
  for (const url of [
    "http://[::1]/",
    "http://[::]/",
    "http://[fe80::1]/",
    "http://[fc00::1]/",
    "http://[fd12:3456::1]/",
    "http://[ff02::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[::ffff:10.0.0.1]/",
    "http://[64:ff9b::7f00:1]/",
    "http://[2002:7f00:1::1]/",
    "http://[0:0:0:0:0:0:0:1]/",
  ])
    expect(allowed(url), url).toBe(false)
  expect(allowed("http://[::ffff:8.8.8.8]/")).toBe(true)
})

it("url policy opt-out allows private hosts but still only http(s) without credentials", () => {
  expect(checkUrl("http://localhost:3000/", true).ok).toBe(true)
  expect(checkUrl("http://10.0.0.1/", true).ok).toBe(true)
  expect(checkUrl("file:///etc/passwd", true).ok).toBe(false)
  expect(checkUrl("http://u:p@localhost/", true).ok).toBe(false)
})
