import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"

// The two session gates of the auth add-ons (apps/web/src/server/api-session.ts and
// require-session.ts), loaded from the templates with their imports replaced by stubs: nobody is
// signed in, and the public lists are whatever a test gives.

const repo = new URL("..", import.meta.url).pathname
const server = join(repo, "templates/auth/better-auth/files/shared/server")
const cache = join(repo, "node_modules/.cache")
mkdirSync(cache, { recursive: true })
const tmp = mkdtempSync(join(cache, "efforge-session-gates-"))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
afterEach(() => vi.restoreAllMocks())

const write = (name: string, source: string) => {
  const file = join(tmp, `${name}-${Math.random().toString(36).slice(2)}.ts`)
  writeFileSync(file, source)
  return file
}

/** `requireApiSession`, signed out, with `paths` as public-api-paths.json. */
const apiGate = async (
  paths: unknown = JSON.parse(readFileSync(join(server, "public-api-paths.json"), "utf8")),
) => {
  const source = readFileSync(join(server, "api-session.ts"), "utf8")
    .replace(
      /^import publicApiPaths from .*$/m,
      `const publicApiPaths: any = ${JSON.stringify(paths)}`,
    )
    .replace(
      /^import type .*$/m,
      "type WorkerRoute = (request: Request) => Promise<Response | undefined>",
    )
    .replace(
      /^import \{ runtime \} from .*$/m,
      "const runtime = { runPromise: (x: unknown) => Promise.resolve(x) }",
    )
    .replace(/^import \{ signedIn \} from .*$/m, "const signedIn = (_: Headers) => false")
  const { requireApiSession } = (await import(write("api-session", source))) as {
    requireApiSession: (request: Request) => Promise<Response | undefined>
  }
  /** What the gate does with `path`, sent as written: `pass` (on to the next route) or 401. */
  return async (path: string) => {
    const answer = await requireApiSession(new Request(`http://localhost${path}`))
    return answer === undefined ? "pass" : answer.status
  }
}

/** `sessionGate`, signed out, with `list` as public-server-fns.json. */
const fnGate = async (list: unknown) => {
  const source = readFileSync(join(server, "require-session.ts"), "utf8")
    .replace(
      /^import \{ Auth, type Session \} from .*$/m,
      "type Session = unknown\nconst Auth = { use: (_: unknown) => undefined }",
    )
    .replace(
      /^import \{ createMiddleware \} from .*$/m,
      "const createMiddleware = (_: unknown) => ({ server: (fn: any) => fn })",
    )
    .replace(/^import \{ getRequest \} from .*$/m, "const getRequest = () => ({})")
    .replace(
      /^import publicServerFns from .*$/m,
      `const publicServerFns: any = ${JSON.stringify(list)}`,
    )
    .replace(
      /^import \{ runtime \} from .*$/m,
      'const runtime = { runPromise: (_: unknown) => Promise.reject(new Error("Unauthorized")) }',
    )
  const { sessionGate } = (await import(write("require-session", source))) as {
    sessionGate: (opts: {
      next: () => Promise<string>
      serverFnMeta: { filename: string; name: string }
    }) => Promise<string>
  }
  /** Whether a signed-out call of `name` in `file` (relative to apps/web) reaches its handler. */
  return (filename: string, name: string) =>
    sessionGate({ next: () => Promise.resolve("ran"), serverFnMeta: { filename, name } }).then(
      () => true,
      () => false,
    )
}

describe("the route gate (requireApiSession), signed out", () => {
  it("lets through exactly what auth-route.ts serves: the raw path under /api/auth/", async () => {
    const gate = await apiGate()
    for (const path of ["/api/auth/get-session", "/api/auth/sign-in/email", "/api/auth/ok?x=1"])
      expect(await gate(path), path).toBe("pass")
  })

  it("refuses every other spelling of /api/auth/, which auth-route.ts does not take and the router may", async () => {
    const gate = await apiGate()
    const variants = [
      // case: TanStack's router matches paths without regard to case
      "/API/auth/leak",
      "/Api/auth/leak",
      "/api/AUTH/leak",
      "/api/Auth/leak",
      // percent-encoding
      "/%61pi/auth/leak",
      "/%41PI/auth/leak",
      "/api/%61uth/leak",
      "/api%2Fauth/leak",
      "/api/auth%2Fleak",
      "/api/auth/..%2Fleak",
      "/api/auth/%2e%2e/leak",
      "/api/auth/.%2e/leak",
      "/api/auth/..%5Cleak",
      // empty segments and trailing slashes
      "//api/auth/leak",
      "/api//auth/leak",
      "/api/auth",
      "/API/auth/",
      "/api/auth/../leak",
    ]
    for (const path of variants) expect(await gate(path), path).toBe(401)
  })

  it("refuses everything else under /api/, however it is spelled", async () => {
    const gate = await apiGate()
    for (const path of [
      "/api",
      "/api/",
      "/API",
      "/api/leak",
      "/API/leak",
      "/api/leak/",
      "/%61pi/leak",
      "/api%2Fleak",
      "//api/leak",
      "/api\\leak",
    ])
      expect(await gate(path), path).toBe(401)
  })

  it("leaves paths outside /api/ to the routes after it", async () => {
    const gate = await apiGate()
    for (const path of ["/", "/apix", "/outside", "/app", "/ws/rooms/demo"])
      expect(await gate(path), path).toBe("pass")
  })

  it("makes nothing public when public-api-paths.json has the wrong shape, and says so", async () => {
    for (const paths of [
      "/api/auth/",
      { "/api/auth/": true },
      null,
      [1],
      ["/api/auth"],
      ["/"],
      ["/apix/"],
    ]) {
      const error = vi.spyOn(console, "error").mockImplementation(() => {})
      const gate = await apiGate(paths)
      expect(await gate("/api/auth/get-session"), JSON.stringify(paths)).toBe(401)
      expect(await gate("/api/leak"), JSON.stringify(paths)).toBe(401)
      expect(error).toHaveBeenCalledWith(expect.stringContaining("public-api-paths.json must be"))
      error.mockRestore()
    }
  })
})

describe("the function gate (sessionGate), signed out", () => {
  const file = "src/server/export.ts"
  const key = `apps/web/${file}`

  it("runs only the functions the public list names, by file and exact name", async () => {
    const gate = await fnGate({ [key]: ["exportAll"] })
    expect(await gate(file, "exportAll")).toBe(true)
    expect(await gate(file, "export")).toBe(false)
    expect(await gate(file, "exportAllX")).toBe(false)
    expect(await gate("src/server/Export.ts", "exportAll")).toBe(false)
  })

  it("makes nothing public when public-server-fns.json has the wrong shape, and says so", async () => {
    const lists = [
      { [key]: "exportAll,aliased" }, // a string is not a list: no substring match
      { [key]: [["exportAll"]] },
      { [key]: [1] },
      [key],
      "exportAll",
      null,
      true,
    ]
    for (const list of lists) {
      const error = vi.spyOn(console, "error").mockImplementation(() => {})
      const gate = await fnGate(list)
      for (const name of ["exportAll", "aliased"])
        expect(await gate(file, name), `${JSON.stringify(list)} ${name}`).toBe(false)
      expect(error).toHaveBeenCalledWith(expect.stringContaining("public-server-fns.json must be"))
      error.mockRestore()
    }
  })
})
