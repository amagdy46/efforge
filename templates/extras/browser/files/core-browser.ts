import { Context, Data, Effect } from "effect"

/** The browser could not load the page, or the container failed; `cause` is the underlying error. */
export class BrowserError extends Data.TaggedError("BrowserError")<{
  readonly operation: string
  readonly cause: unknown
}> {
  override get message(): string {
    const cause = this.cause instanceof Error ? `: ${this.cause.message}` : ""
    return `Browser ${this.operation} failed${cause}`
  }
}

/** No browser container is running here; `message` says what to start or set. */
export class BrowserUnavailable extends Data.TaggedError("BrowserUnavailable")<{
  readonly message: string
}> {}

/** The container's URL policy refused the address (a private or local network). */
export class UrlRefused extends Data.TaggedError("UrlRefused")<{
  readonly message: string
}> {}

/** Not an http(s) URL. */
export class InvalidUrl extends Data.TaggedError("InvalidUrl")<{
  readonly message: string
}> {}

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

// #region card
/** Loads `url` in the headless browser and reports what the page did. */
export const visit = (url: string) =>
  Effect.gen(function* () {
    const parsed = URL.parse(url.trim())
    if (parsed === null || !["http:", "https:"].includes(parsed.protocol))
      return yield* new InvalidUrl({
        message: "Enter an http:// or https:// address.",
      })
    const browser = yield* Browser
    return yield* browser.run(parsed.href)
  })
// #endregion
