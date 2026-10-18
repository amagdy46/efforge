import { chromium, type Page } from "playwright"

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
