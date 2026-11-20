import { createServer } from "node:http"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Effect, Layer, Result, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { type Browser, chromium } from "playwright"
import { checkUrl } from "./url-policy.ts"

/*
 * SECURITY (SSRF): this server loads any URL it is sent, from inside your network. Requests are
 * checked against ./url-policy.ts: http(s) only, and by default no localhost, `.local`/`.internal`
 * hosts or private, loopback and link-local IPs (such as the 169.254.169.254 metadata endpoint).
 * Every request the page makes, including redirects, goes through the same check. DNS names that
 * resolve to private addresses are not detected, so also limit what this container can reach.
 * Only set ALLOW_PRIVATE_NETWORKS to true for a container that cannot reach anything sensitive.
 */
const ALLOW_PRIVATE_NETWORKS = false

const RunRequest = Schema.Struct({
  url: Schema.String.check(Schema.isMaxLength(2048)),
})

let browser: Promise<Browser> | undefined
const getBrowser = () => {
  browser ??= chromium.launch({ args: ["--no-sandbox"] })
  return browser
}

/** Loads `url` in a fresh context, counts the requests the page made and takes a screenshot. */
const inspect = async (url: string) => {
  const context = await (await getBrowser()).newContext({ viewport: { width: 1280, height: 800 } })
  try {
    await context.route("**/*", (route) => {
      const target = route.request().url()
      const allowed = !/^https?:/i.test(target) || checkUrl(target, ALLOW_PRIVATE_NETWORKS).ok
      return allowed ? route.continue() : route.abort("blockedbyclient")
    })
    const page = await context.newPage()
    let requests = 0
    page.on("request", () => {
      requests += 1
    })
    await page.goto(url, { waitUntil: "load", timeout: 30_000 })
    const screenshot = await page.screenshot({ type: "jpeg", quality: 60 })
    return { title: await page.title(), requests, screenshot: screenshot.toString("base64") }
  } finally {
    await context.close()
  }
}

/** Why a page did not load, for the 502 body. */
const loadFailure = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error)
  if (error.name === "TimeoutError")
    return "the page did not load in 30 seconds: it is slow, or this container cannot reach it"
  return error.message
}

const run = HttpRouter.add(
  "POST",
  "/run",
  Effect.gen(function* () {
    const { url: raw } = yield* HttpServerRequest.schemaBodyJson(RunRequest)
    const checked = checkUrl(raw, ALLOW_PRIVATE_NETWORKS)
    // 403: the URL policy refused it; 502: the page could not be loaded; 400: a bad request
    if (!checked.ok)
      return yield* HttpServerResponse.json({ error: checked.reason }, { status: 403 })
    const url = checked.url.href
    const result = yield* Effect.tryPromise({
      try: () => inspect(url),
      catch: loadFailure,
    }).pipe(Effect.result)
    if (Result.isFailure(result))
      return yield* HttpServerResponse.json({ error: result.failure }, { status: 502 })
    return yield* HttpServerResponse.json(result.success)
  }).pipe(
    Effect.catch((error) =>
      HttpServerResponse.json({ error: String(error) }, { status: 400 }).pipe(Effect.orDie),
    ),
  ),
)

const health = HttpRouter.add("GET", "/health", HttpServerResponse.text("ok"))

const port = Number(process.env.PORT ?? 8080)

const server = HttpRouter.serve(Layer.mergeAll(run, health)).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port, host: "0.0.0.0" })),
)

NodeRuntime.runMain(Layer.launch(server))
