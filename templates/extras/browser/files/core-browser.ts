import { Context, Effect, Schema } from "effect"
import { ServerOnly } from "./server-only"

/**
 * The browser could not load the page, or the container failed. `cause` (the
 * underlying error) stays on the server; the browser gets `message`.
 */
export class BrowserError extends Schema.TaggedError<
  BrowserError,
  { readonly brand: unique symbol }
>()("BrowserError", { operation: Schema.String, cause: ServerOnly }) {
  override get message(): string {
    const cause = this.cause instanceof Error ? `: ${this.cause.message}` : ""
    return `Browser ${this.operation} failed${cause}`
  }
}

/** No browser container is running here; `message` says what to start or set. */
export class BrowserUnavailable extends Schema.TaggedError<
  BrowserUnavailable,
  { readonly brand: unique symbol }
>()("BrowserUnavailable", { message: Schema.String }) {}

/** The container's URL policy refused `url` (a private or local network). */
export class UrlRefused extends Schema.TaggedError<UrlRefused, { readonly brand: unique symbol }>()(
  "UrlRefused",
  { message: Schema.String, url: Schema.String },
) {}

export interface BrowserRun {
  readonly title: string
  /** Network requests the page made while loading. */
  readonly requests: number
  /** A JPEG of the page as it loaded, base64 */
  readonly screenshot: string
}

/** A headless browser. The Cloudflare layer runs Playwright in the `apps/browser` container. */
export class Browser extends Context.Service<
  Browser,
  {
    /** Loads `url` and reports what the page did. */
    readonly run: (
      url: string,
    ) => Effect.Effect<BrowserRun, BrowserError | BrowserUnavailable | UrlRefused>
  }
>()("@repo/core/Browser") {}

/** `url` is not an http(s) URL. */
export class InvalidUrl extends Schema.TaggedError<InvalidUrl, { readonly brand: unique symbol }>()(
  "InvalidUrl",
  { message: Schema.String, url: Schema.String },
) {}

// #region card
/** Loads `url` in the headless browser and reports what the page did. */
export const visit = (url: string) =>
  Effect.gen(function* () {
    const parsed = URL.parse(url.trim())
    if (parsed === null || !["http:", "https:"].includes(parsed.protocol))
      return yield* new InvalidUrl({
        message: "Enter an http:// or https:// address.",
        url,
      })
    const browser = yield* Browser
    return yield* browser.run(parsed.href)
  })
// #endregion
