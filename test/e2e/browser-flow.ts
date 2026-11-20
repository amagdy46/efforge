import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { request as httpRequest } from "node:http"
import { join } from "node:path"
import { chromium, type Page, type Request } from "playwright"
import { PUBLIC_SERVER_FNS } from "../../src/cards.ts"

/** Server functions signed-out visitors must reach (the route guard, the landing page). */
const PUBLIC = new Set(Object.values(PUBLIC_SERVER_FNS).flat())

const password = "correct-horse-battery"

// forms only work once React has hydrated; clicking earlier would submit them natively
const hydrated = (page: Page) => page.waitForLoadState("networkidle")

const signUp = async (page: Page, name: string, email: string) => {
  await hydrated(page)
  await page.getByLabel("Name").fill(name)
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Create account" }).click()
}

/** A POST to `url` with `Host: host`, which fetch cannot send. */
const postWithHost = (url: string, host: string, body: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method: "POST",
        headers: { host, origin: `http://${host}`, "content-type": "application/json" },
      },
      (res) => {
        let text = ""
        res.on("data", (chunk: Buffer) => (text += chunk.toString()))
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }))
      },
    )
    req.on("error", reject)
    req.end(body)
  })

/**
 * Uses the storage, email, workflows, AI and browser cards: each one's working state and its tagged
 * error. Needs no account: R2, email and Workflows are emulated, the AI card has no key (with
 * organizations it says to add one) and containers are off in local dev.
 */
/**
 * The RPC card: a value, a typed error with its field, a stream that arrives a number at a time,
 * and the notes the database card wrote, read through the Notes service over RPC.
 */
const useRpcCard = async (page: Page) => {
  const rpc = page.locator("#rpc")
  await rpc.getByLabel("Name").fill("Ann")
  await rpc.getByRole("button", { name: "Call Greet" }).click()
  await rpc.getByText("Hello, Ann").waitFor()
  await rpc.getByLabel("Name").fill("")
  await rpc.getByRole("button", { name: "Call Greet" }).click()
  const invalid = rpc.getByRole("alert").filter({ hasText: "InvalidName" })
  await invalid.getByText("length:").waitFor()
  await rpc.getByRole("button", { name: "Stream a countdown" }).click()
  // a number shows while the stream is still open, then the stream ends at 0
  await rpc.getByText("arriving, one every 400 ms").waitFor()
  await rpc.getByText("the stream ended").waitFor({ timeout: 15_000 })
  await rpc.getByRole("button", { name: "List notes over RPC" }).click()
  await rpc.getByText(/newest "written by Ann at \d+"/).waitFor()
}

/**
 * Signed out, `/api/rpc` is refused by the session gate (401 `Unauthorized`), and the card's call
 * fails with the group's `Unauthorized`, marked as rejected.
 */
const rpcRefusedSignedOut = async (page: Page, baseURL: string) => {
  const raw = await fetch(`${baseURL}/api/rpc`, {
    method: "POST",
    headers: { "content-type": "application/ndjson" },
    body: '{"_tag":"Request","id":"1","tag":"Greet","payload":{"name":"x"},"headers":[]}\n',
  })
  const body = await raw.text()
  if (raw.status !== 401 || !body.includes("Unauthorized"))
    throw new Error(`/api/rpc answered without a session: ${raw.status} ${body.slice(0, 200)}`)
  await page.goto("/app#rpc")
  await hydrated(page)
  await page.context().clearCookies()
  const rpc = page.locator("#rpc")
  await rpc.getByRole("button", { name: "Call Greet" }).click()
  const refused = rpc.getByRole("alert").filter({ hasText: "Unauthorized" })
  await refused.getByText("The server rejected the call.").waitFor()
}

const useServiceCards = async (page: Page) => {
  const storage = page.locator("#storage")
  await storage.getByText("No files yet").waitFor()
  const upload = storage.getByRole("button", { name: "Upload", exact: true })
  await storage.getByLabel("File to upload").setInputFiles({
    name: "big.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(1_100_000),
  })
  await upload.click()
  await storage.getByRole("alert").getByText("FileTooLarge").waitFor()
  await storage.getByLabel("File to upload").setInputFiles({
    name: "hello.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello from R2\n"),
  })
  await upload.click()
  const link = storage.getByRole("link", { name: "hello.txt" })
  await link.waitFor()
  const download = await page.request.get((await link.getAttribute("href")) ?? "")
  if (download.status() !== 200 || (await download.text()) !== "hello from R2\n")
    throw new Error(`the signed link answered ${download.status()}`)
  await storage.getByRole("button", { name: "Delete hello.txt" }).click()
  await storage.getByText("No files yet").waitFor()
  // one file stays, for the second user to not see
  await storage.getByLabel("File to upload").setInputFiles({
    name: "ann-keeps.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Ann's\n"),
  })
  await upload.click()
  await storage.getByRole("link", { name: "ann-keeps.txt" }).waitFor()

  const email = page.locator("#email")
  const send = email.getByRole("button", { name: "Send a test email" })
  await email.getByLabel("To").fill("not an address")
  await send.click()
  await email.getByRole("alert").getByText("InvalidAddress").waitFor()
  await email.getByLabel("To").fill("ada@example.com")
  await send.click()
  await email.getByText("Printed to the dev server log").waitFor()

  const workflows = page.locator("#workflows")
  const start = workflows.getByRole("button", { name: "Start workflow" })
  await workflows.getByLabel("Name").fill(" ")
  await start.click()
  await workflows.getByRole("alert").getByText("MissingName").waitFor()
  await workflows.getByLabel("Name").fill("Ada")
  await start.click()
  await workflows.getByText("Hello, Ada! The workflow finished.").waitFor({ timeout: 90_000 })

  const ai = page.locator("#ai")
  await ai.getByRole("button", { name: "Ask" }).click()
  await ai.getByText("Not configured yet").waitFor()
  await ai.getByLabel("Prompt").fill("")
  await ai.getByRole("button", { name: "Ask" }).click()
  await ai.getByText("EmptyPrompt").last().waitFor()

  const browser = page.locator("#browser")
  const open = browser.getByRole("button", { name: "Open" })
  await browser.getByLabel("Address").fill("ftp://example.com")
  await open.click()
  await browser.getByRole("alert").getByText("InvalidUrl").waitFor()
  await browser.getByLabel("Address").fill("https://example.com")
  await open.click()
  await browser.getByText("Not configured yet").waitFor({ timeout: 100_000 })
}

/** The export a `/_serverFn/<id>` URL calls: the id is base64url JSON naming it. */
const serverFnName = (url: string): string => {
  try {
    const id = url.split("/_serverFn/")[1]?.split("?")[0] ?? ""
    return String(
      (JSON.parse(Buffer.from(id, "base64url").toString()) as { export?: unknown }).export,
    )
  } catch {
    return ""
  }
}

/** The first user's calls the second one replays (set by cardsRequireSession). */
let annWatch: string | undefined
let annUpload: string | undefined

/**
 * The reviewer's bypasses of the session guard, planted in a generated auth project before it
 * runs: a server function through an alias, through a re-export, behind a middleware merely named
 * `requireSession` and behind another one imported as `requireSession`; a Worker route and a
 * route file under `/api/`. Each answers "LEAK" if it runs. `bypassesRefused` calls them.
 */
export const plantBypasses = (dir: string) => {
  const web = join(dir, "apps/web/src")
  const write = (file: string, lines: string[]) => {
    mkdirSync(join(web, file, ".."), { recursive: true })
    writeFileSync(join(web, file), `${lines.join("\n")}\n`)
  }
  write("server/bypass-src.ts", [
    'export { createServerFn as serverFn } from "@tanstack/react-start"',
  ])
  write("server/bypass-reexport.ts", [
    'import { serverFn } from "./bypass-src"',
    'export const leakReexport = serverFn({ method: "GET" }).handler(() => "LEAK")',
  ])
  write("server/bypass-alias.ts", [
    'import { createServerFn } from "@tanstack/react-start"',
    "const make = createServerFn",
    'export const leakAlias = make({ method: "GET" }).handler(() => "LEAK")',
  ])
  write("server/bypass-named.ts", [
    'import { createMiddleware, createServerFn } from "@tanstack/react-start"',
    'const requireSession = createMiddleware({ type: "function" }).server(({ next }) => next())',
    'export const leakNamed = createServerFn({ method: "GET" })',
    "  .middleware([requireSession])",
    '  .handler(() => "LEAK")',
  ])
  write("server/bypass-log.ts", [
    'import { createMiddleware } from "@tanstack/react-start"',
    'export const logCalls = createMiddleware({ type: "function" }).server(({ next }) => next())',
  ])
  write("server/bypass-renamed.ts", [
    'import { createServerFn } from "@tanstack/react-start"',
    'import { logCalls as requireSession } from "./bypass-log"',
    'export const leakRenamed = createServerFn({ method: "GET" })',
    "  .middleware([requireSession])",
    '  .handler(() => "LEAK")',
  ])
  write("server/bypass-route.ts", [
    'import type { WorkerRoute } from "./routes"',
    "export const exportRoute: WorkerRoute = (request) =>",
    '  Promise.resolve(new URL(request.url).pathname === "/api/export" ? new Response("LEAK") : undefined)',
  ])
  const routes = join(web, "server/routes.ts")
  writeFileSync(
    routes,
    readFileSync(routes, "utf8")
      .replace(/^/, 'import { exportRoute } from "./bypass-route"\n')
      .replace(/\n\]\s*$/, "\n  exportRoute,\n]\n"),
  )
  write("routes/api/leak.ts", [
    'import { createFileRoute } from "@tanstack/react-router"',
    'export const Route = createFileRoute("/api/leak")({',
    '  server: { handlers: { GET: () => new Response("LEAK") } },',
    "})",
  ])
  write("routes/bypass.tsx", [
    'import { createFileRoute } from "@tanstack/react-router"',
    'import { leakAlias } from "@/server/bypass-alias"',
    'import { leakNamed } from "@/server/bypass-named"',
    'import { leakReexport } from "@/server/bypass-reexport"',
    'import { leakRenamed } from "@/server/bypass-renamed"',
    'export const Route = createFileRoute("/bypass")({',
    "  component: () => (",
    '    <button type="button" onClick={() => void Promise.allSettled([leakAlias(), leakNamed(), leakReexport(), leakRenamed()])}>',
    "      go",
    "    </button>",
    "  ),",
    "})",
  ])
}

/** Signed out, every planted bypass is refused: the four server functions and both routes. */
const bypassesRefused = async (page: Page, baseURL: string) => {
  const answers: string[] = []
  page.on("response", async (r) => {
    if (r.url().includes("/_serverFn/")) answers.push(await r.text().catch(() => ""))
  })
  await page.goto("/bypass")
  await hydrated(page)
  await page.getByRole("button", { name: "go" }).click()
  for (let i = 0; i < 60 && answers.length < 4; i++) await page.waitForTimeout(250)
  if (answers.length !== 4) throw new Error(`the bypass page made ${answers.length} calls, not 4`)
  for (const body of answers)
    if (body.includes("LEAK") || !body.includes("Unauthorized"))
      throw new Error(`a planted server function answered signed out: ${body.slice(0, 200)}`)
  for (const path of [
    "/api/export",
    "/api/leak",
    "/API/leak",
    "/%61pi/leak",
    "/api/auth/..%2Fleak",
  ]) {
    const r = await fetch(`${baseURL}${path}`)
    const body = await r.text()
    if (r.status !== 401 || body.includes("LEAK"))
      throw new Error(`${path} answered signed out: ${r.status} ${body.slice(0, 200)}`)
  }
}

/** The second user sees none of the first one's files and can't watch the first one's run. */
const othersDataIsTheirs = async (page: Page) => {
  await page.goto("/app")
  await hydrated(page)
  const storage = page.locator("#storage")
  await storage.getByText("No files yet").waitFor()
  if ((await storage.getByRole("link", { name: "ann-keeps.txt" }).count()) !== 0)
    throw new Error("the second user sees the first user's upload")
  if (annWatch === undefined || annUpload === undefined)
    throw new Error("the first user's calls were not recorded")
  const watched = await (await page.request.get(annWatch)).text()
  if (!watched.includes("UnknownRun"))
    throw new Error(`the second user watched the first user's run: ${watched.slice(0, 200)}`)
  const listed = await (await page.request.get(annUpload)).text()
  if (listed.includes("ann-keeps.txt"))
    throw new Error("the second user's listFiles returned the first user's upload")
}

/**
 * At 1280 px, a laptop's width, every file of every card's code panel shows its lines whole: the
 * card lays the code column out to hold 80 characters (docs/capability-cards.md).
 */
const codePanelsFit1280 = async (page: Page) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/app")
  await hydrated(page)
  const tabs = page.locator('section[id] [role="tab"]')
  const scrolling: string[] = []
  const measure = () =>
    // a string, since this file is type-checked without the DOM library
    page.evaluate<
      string[]
    >(`(() => [...document.querySelectorAll("section[id]")].flatMap((card) => {
      const pre = card.querySelector("pre")
      const tab = card.querySelector('[role="tab"][aria-selected="true"]')
      return pre && pre.scrollWidth > pre.clientWidth + 1
        ? [card.id + " " + (tab ? tab.textContent : "") + " " + pre.scrollWidth + " in " + pre.clientWidth]
        : []
    }))()`)
  scrolling.push(...(await measure()))
  for (let i = 0; i < (await tabs.count()); i++) {
    await tabs.nth(i).click()
    scrolling.push(...(await measure()))
  }
  if (scrolling.length > 0)
    throw new Error(`code panels scroll sideways at 1280 px: ${[...new Set(scrolling)].join(", ")}`)
}

/** At 390 px, with long unbroken input in the cards, nothing is wider than its card or the page. */
const cardsFitPhoneWidth = async (page: Page) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/app")
  await hydrated(page)
  const database = page.locator("#database")
  // unbroken, and unique per run: a database reused from an earlier run has the last one
  const note = `${"n".repeat(170)}${Date.now()}`
  await database.getByLabel("New note").fill(note)
  await database.getByRole("button", { name: "Add note" }).click()
  await database.getByText(note).waitFor()
  const storage = page.locator("#storage")
  const name = "quarterly-report-2026-final-reviewed.pdf"
  await storage.getByLabel("File to upload").setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n"),
  })
  await storage.getByRole("button", { name: "Upload", exact: true }).click()
  await storage.getByRole("link", { name }).waitFor()
  const workflows = page.locator("#workflows")
  await workflows.getByLabel("Name").fill("W".repeat(100))
  await workflows.getByRole("button", { name: "Start workflow" }).click()
  await workflows.getByText(/The workflow finished/).waitFor({ timeout: 90_000 })
  const email = page.locator("#email")
  await email.getByLabel("To").fill(`${"a".repeat(60)}@example.com`)
  await email.getByRole("button", { name: "Send a test email" }).click()
  await email.getByText("Printed to the dev server log").waitFor()
  // a string, since this file is type-checked without the DOM library
  const wide = await page.evaluate<string[]>(`(() => {
    const out = []
    if (document.documentElement.scrollWidth > window.innerWidth)
      out.push("page " + document.documentElement.scrollWidth)
    for (const card of document.querySelectorAll("section[id]"))
      for (const pane of card.querySelectorAll(":scope > div > div"))
        if (pane.scrollWidth > pane.clientWidth + 1)
          out.push(card.id + " " + pane.scrollWidth + " in " + pane.clientWidth)
    return out
  })()`)
  if (wide.length > 0) throw new Error(`too wide at 390 px: ${wide.join(", ")}`)
  // the uploaded file goes, so the second user's check starts from Ann's one file
  await storage.getByRole("button", { name: `Delete ${name}` }).click()
  await storage.getByRole("link", { name }).waitFor({ state: "detached" })
  await page.setViewportSize({ width: 1280, height: 800 })
}

/**
 * Uses every card's demo as a signed-in user, then replays each server function call the dashboard
 * made without the session cookie: every one must be refused with `Unauthorized`, reads included.
 * Also checks that a failed add keeps the typed note.
 */
const cardsRequireSession = async (page: Page) => {
  const calls: Request[] = []
  page.on("request", (r) => {
    if (r.url().includes("/_serverFn/")) calls.push(r)
  })
  await page.reload()
  await hydrated(page)
  const runtime = page.locator("#runtime")
  await runtime.getByLabel("Name").fill("Ann")
  await runtime.getByRole("button", { name: "Run on the server" }).click()
  await runtime.getByText("Hello, Ann").waitFor()
  const database = page.locator("#database")
  await database.getByLabel("New note").fill("n".repeat(250))
  await database.getByRole("button", { name: "Add note" }).click()
  await database.getByRole("alert").getByText("InvalidNote").waitFor()
  if ((await database.getByLabel("New note").inputValue()).length !== 250)
    throw new Error("a failed add cleared the note input")
  // unique per run: a database reused from an earlier run already has older notes
  const note = `written by Ann at ${Date.now()}`
  await database.getByLabel("New note").fill(note)
  await database.getByRole("button", { name: "Add note" }).click()
  await database.getByText(note).waitFor()
  const realtime = page.locator("#realtime")
  // a signed-in user's socket is let in
  await realtime.getByText("Connected", { exact: true }).waitFor()
  await realtime.getByRole("button", { name: "Send from the server" }).click()
  await realtime.getByText(/broadcast it to/).waitFor()
  await useServiceCards(page)
  await useRpcCard(page)

  annWatch = calls.find((c) => serverFnName(c.url()).startsWith("watchWorkflow"))?.url()
  annUpload = calls.find((c) => serverFnName(c.url()).startsWith("listFiles"))?.url()
  const seen = new Map(calls.map((c) => [`${c.method()} ${c.url()}`, c]))
  const names = new Set<string>()
  for (const call of seen.values()) {
    const headers = { ...(await call.allHeaders()) }
    delete headers.cookie
    const response = await fetch(call.url(), {
      method: call.method(),
      headers,
      ...(call.method() === "POST" ? { body: call.postData() ?? "" } : {}),
    })
    const body = await response.text()
    const name = JSON.parse(
      Buffer.from(call.url().split("/_serverFn/")[1]?.split("?")[0] ?? "", "base64url").toString(),
    ).export as string
    const fn = name.split("_")[0] as string
    names.add(fn)
    // public by design (the realtime card reads getStack): it answers without a session
    if (PUBLIC.has(fn)) continue
    // the guard's own refusal: its tag and its message, not merely the word somewhere in the body
    if (!body.includes("Unauthorized") || !body.includes("Not signed in"))
      throw new Error(
        `${name} answered a request without a session: ${response.status} ${body.slice(0, 200)}`,
      )
  }
  // the realtime room refuses a socket without a session, with a close code the card can show
  const socket = new WebSocket(
    `${page
      .url()
      .replace(/^http/, "ws")
      .replace(/\/app.*$/, "")}/ws/rooms/demo`,
  )
  const closed = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("an anonymous socket was not closed")), 15_000)
    socket.addEventListener("message", () => reject(new Error("an anonymous socket got a message")))
    socket.addEventListener("close", ({ code, reason }) => {
      clearTimeout(timer)
      resolve({ code, reason })
    })
  })
  if (closed.code !== 4401)
    throw new Error(`an anonymous socket closed with ${closed.code} ${closed.reason}, not 4401`)
  for (const fn of [
    "greet",
    "listNotes",
    "addNote",
    "announce",
    "listFiles",
    "uploadFile",
    "deleteFile",
    "mailSettings",
    "sendTestEmail",
    "startWorkflow",
    "watchWorkflow",
    "askModel",
    "visitPage",
  ])
    if (!names.has(fn))
      throw new Error(`the dashboard never called ${fn}; replayed ${[...names].join(", ")}`)
}

/**
 * Drives a running `pnpm dev` of a `better-auth-orgs` project: sign up, create an organization,
 * invite a member (the link is shown), sign up a second user through the link, and check that both
 * users see both members. Throws on the first failed expectation.
 */
export const orgsFlow = async (baseURL: string): Promise<void> => {
  const stamp = Date.now()
  const ann = { name: "Ann Owner", email: `ann-${stamp}@example.com` }
  const bob = { name: "Bob Invited", email: `bob-${stamp}@example.com` }
  const browser = await chromium.launch()
  try {
    const expectVisible = async (page: Page, text: string) =>
      page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 30_000 })

    // signed out: the reviewer's bypasses of the session guard are all refused
    await bypassesRefused(await (await browser.newContext({ baseURL })).newPage(), baseURL)

    // user one: guard -> sign up -> first sign-in creates an organization
    const annPage = await (await browser.newContext({ baseURL })).newPage()
    await annPage.goto("/app")
    await annPage.waitForURL(/\/sign-in/)
    await annPage.getByRole("link", { name: "Sign up" }).click()
    await annPage.waitForURL(/\/sign-up/)
    await signUp(annPage, ann.name, ann.email)
    await annPage.waitForURL(/\/onboarding/)
    await hydrated(annPage)
    await annPage.getByLabel("Organization name").fill("Acme Inc")
    await annPage.getByRole("button", { name: "Create organization" }).click()
    await annPage.waitForURL(/\/app$/)
    await expectVisible(annPage, "Dashboard")
    await expectVisible(annPage, "Notes")
    // every card renders on the database + auth dashboard (the stack includes realtime)
    await expectVisible(annPage, "Realtime room")
    await cardsRequireSession(annPage)
    await cardsFitPhoneWidth(annPage)
    await codePanelsFit1280(annPage)
    // a host Better Auth does not allow under pnpm dev gets a clear 403, not a 500
    const lan = await postWithHost(
      `${baseURL}/api/auth/sign-in/email`,
      "192.0.2.1:5199",
      JSON.stringify({ email: ann.email, password }),
    )
    if (lan.status !== 403 || !lan.body.includes("BETTER_AUTH_URL"))
      throw new Error(`sign-in from another host: ${lan.status} ${lan.body.slice(0, 200)}`)
    await annPage
      .getByRole("button", { name: "Switch organization" })
      .getByText("Acme Inc")
      .waitFor()

    // invite: the copyable link is shown
    await annPage.goto("/app/settings/members")
    await expectVisible(annPage, "Members of Acme Inc")
    await hydrated(annPage)
    await annPage.getByLabel("Email", { exact: true }).fill(bob.email)
    await annPage.getByRole("button", { name: "Invite", exact: true }).click()
    const link = await annPage.getByLabel("Invitation link").inputValue({ timeout: 30_000 })
    if (!/\/accept-invite\/[\w-]+$/.test(link)) throw new Error(`unexpected invite link ${link}`)

    // user two: opens the link, signs up, accepts
    const bobPage = await (await browser.newContext({ baseURL })).newPage()
    await bobPage.goto(link)
    await expectVisible(bobPage, "You have been invited")
    await bobPage.getByRole("link", { name: "Sign up" }).click()
    await bobPage.waitForURL(/\/sign-up/)
    await signUp(bobPage, bob.name, bob.email)
    await bobPage.waitForURL(/\/accept-invite\//)
    await hydrated(bobPage)
    await bobPage.getByRole("button", { name: "Accept invitation" }).click()
    await bobPage.waitForURL(/\/app$/)
    await bobPage
      .getByRole("button", { name: "Switch organization" })
      .getByText("Acme Inc")
      .waitFor()
    // in the same organization, Ann's uploads and runs are still hers
    await othersDataIsTheirs(bobPage)

    // both are members, seen from both sides
    for (const page of [bobPage, annPage]) {
      await page.goto("/app/settings/members")
      await expectVisible(page, ann.email)
      await expectVisible(page, bob.email)
    }

    // last, since it signs Ann out
    await rpcRefusedSignedOut(annPage, baseURL)
  } finally {
    await browser.close()
  }
}
