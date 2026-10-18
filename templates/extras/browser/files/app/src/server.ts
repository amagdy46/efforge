import { createServer } from "node:http"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { type Browser, chromium } from "playwright"

const RunRequest = Schema.Struct({
  url: Schema.String.check(Schema.isPattern(/^https?:\/\//)),
})

let browser: Promise<Browser> | undefined
const getBrowser = () => {
  browser ??= chromium.launch({ args: ["--no-sandbox"] })
  return browser
}

/** Loads `url` in a fresh context and counts the requests the page made. */
const inspect = async (url: string) => {
  const context = await (await getBrowser()).newContext()
  try {
    const page = await context.newPage()
    let requests = 0
    page.on("request", () => {
      requests += 1
    })
    await page.goto(url, { waitUntil: "load", timeout: 30_000 })
    return { title: await page.title(), requests }
  } finally {
    await context.close()
  }
}

const run = HttpRouter.add(
  "POST",
  "/run",
  Effect.gen(function* () {
    const { url } = yield* HttpServerRequest.schemaBodyJson(RunRequest)
    const result = yield* Effect.tryPromise({
      try: () => inspect(url),
      catch: (error) => (error instanceof Error ? error.message : String(error)),
    })
    return yield* HttpServerResponse.json(result)
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
