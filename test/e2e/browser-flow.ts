import { request as httpRequest } from "node:http"
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
  for (const fn of ["greet", "listNotes", "addNote", "announce"])
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

    // both are members, seen from both sides
    for (const page of [bobPage, annPage]) {
      await page.goto("/app/settings/members")
      await expectVisible(page, ann.email)
      await expectVisible(page, bob.email)
    }
  } finally {
    await browser.close()
  }
}
