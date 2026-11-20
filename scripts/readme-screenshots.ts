import { execFileSync, spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { chromium, type Page } from "playwright"

/**
 * `pnpm readme:screenshots`: the dashboard pictures at the top of README.md, light and dark.
 *
 *   pnpm readme:screenshots [--out <dir>] [--dir <work dir>] [--keep]
 *
 * It generates `my-app` with D1, Better Auth, AI and every extra, with the CLI of the checkout it
 * runs in (`node src/bin.ts`), migrates the local D1, starts `pnpm dev` on a free port, signs up, adds
 * a note, and writes `.github/assets/dashboard-light.png` and `dashboard-dark.png`: the database
 * card, its demo beside the code behind it. Then it stops the server and deletes the project.
 *
 * Nothing reaches Cloudflare: D1, R2, email and Workflows are emulated by `pnpm dev`, and the AI
 * card has no key. Needs pnpm and the Chromium of the pinned Playwright
 * (`pnpm exec playwright install chromium`). When `oxipng` is on PATH, the PNGs are optimised
 * with it (lossless); otherwise they are written as Chromium made them, and it says so.
 */

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    dir: { type: "string" },
    keep: { type: "boolean", default: false },
  },
})

const repo = join(import.meta.dirname, "..")
const out = resolve(values.out ?? join(repo, ".github/assets"))
const base = resolve(values.dir ?? tmpdir())
mkdirSync(base, { recursive: true })
const work = mkdtempSync(join(base, "efforge-screenshots-"))
const app = join(work, "my-app")

/** The stack in the picture: every card the dashboard can show. */
const stack = [
  "--yes",
  "--database=d1",
  "--orm=effect-sql",
  "--auth=better-auth",
  "--ai=effect-ai-byok",
  "--extras=workflows,realtime,browser,storage,email",
  // with git: without a repository, Tailwind's scanner and the formatter read any .gitignore in a
  // parent directory, and a dotfiles ~/.gitignore of `*` leaves the page without its classes
]

/** The card in the picture, and how wide the page lays it out (GitHub shows it at 830 px). */
const CARD = "#database"
const VIEWPORT = { width: 1240, height: 900 }

const run = (cmd: string, args: ReadonlyArray<string>, cwd: string) => {
  console.log(`$ ${[cmd, ...args].join(" ")}`)
  execFileSync(cmd, args, { cwd, stdio: ["ignore", "inherit", "inherit"] })
}

const freePort = () =>
  new Promise<number>((done, fail) => {
    const server = createServer()
    server.on("error", fail)
    server.listen(0, () => {
      const address = server.address()
      server.close(() => done(typeof address === "object" && address ? address.port : 0))
    })
  })

const waitFor = async (url: string) => {
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${url} did not answer within two minutes`)
}

// forms work once React has hydrated; a click before that submits them natively
const hydrated = (page: Page) => page.waitForLoadState("networkidle")

const shoot = async (baseURL: string) => {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({
      baseURL,
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      timezoneId: "UTC",
      locale: "en-US",
    })
    const page = await context.newPage()
    await page.goto("/sign-up")
    await hydrated(page)
    await page.getByLabel("Name").fill("Ada Lovelace")
    await page.getByLabel("Email").fill("ada@example.com")
    await page.getByLabel("Password").fill("correct-horse-battery")
    await page.getByRole("button", { name: "Create account" }).click()
    await page.waitForURL(/\/app$/)
    await hydrated(page)
    const card = page.locator(CARD)
    // the stylesheet is in place once the card has its rounded border (page code is a string:
    // this file is type-checked without the DOM's types)
    await page.waitForFunction(
      `getComputedStyle(document.querySelector(${JSON.stringify(CARD)})).borderTopLeftRadius !== "0px"`,
      undefined,
      { timeout: 60_000 },
    )
    await card.getByLabel("New note").fill("Read the code beside each demo")
    await card.getByRole("button", { name: "Add note" }).click()
    await card.getByText("Read the code beside each demo").waitFor()
    // no caret, focus ring or hover state in the picture
    await page.evaluate("document.activeElement?.blur()")
    await page.mouse.move(0, 0)
    for (const scheme of ["light", "dark"] as const) {
      // the app follows the system theme until someone picks one
      await page.emulateMedia({ colorScheme: scheme })
      await page.waitForTimeout(300)
      const file = join(out, `dashboard-${scheme}.png`)
      await card.screenshot({ path: file, animations: "disabled" })
      console.log(`wrote ${file}`)
    }
  } finally {
    await browser.close()
  }
}

const optimise = (files: ReadonlyArray<string>) => {
  if (spawnSync("oxipng", ["--version"]).status !== 0) {
    console.log("oxipng is not on PATH: the PNGs are not optimised")
    return
  }
  run("oxipng", ["-o", "4", "--strip", "safe", ...files], out)
}

let dev: ReturnType<typeof spawn> | undefined
try {
  run("node", [join(repo, "src/bin.ts"), "my-app", ...stack], work)
  run("pnpm", ["db:migrate"], app)
  const port = await freePort()
  // its own process group (pnpm -> vite -> workerd), so stopping it stops all of it
  dev = spawn(
    "pnpm",
    ["--filter", "web", "exec", "vite", "dev", "--port", `${port}`, "--strictPort"],
    {
      cwd: app,
      detached: true,
      stdio: "ignore",
    },
  )
  const baseURL = `http://localhost:${port}`
  await waitFor(`${baseURL}/sign-in`)
  mkdirSync(out, { recursive: true })
  await shoot(baseURL)
  const files = ["light", "dark"].map((s) => join(out, `dashboard-${s}.png`))
  optimise(files)
  for (const f of files) console.log(`${f}: ${Math.round(statSync(f).size / 1024)} KB`)
} finally {
  if (dev?.pid !== undefined) process.kill(-dev.pid)
  if (values.keep) console.log(`kept ${work}`)
  else rmSync(work, { recursive: true, force: true })
}
