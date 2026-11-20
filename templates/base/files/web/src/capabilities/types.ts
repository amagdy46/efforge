import type { ComponentType } from "react"

/** A file shown on a card: its path in the repo and the part of it to show. */
export interface CodeFile {
  readonly path: string
  readonly source: string
}

/**
 * One card on the dashboard: a working demo, the Effect code behind it, and where to go next.
 * Add-ons ship one per capability (see docs/capability-cards.md in the efforge repo).
 */
export interface Capability {
  /** Anchor and key, e.g. `realtime`; the landing page links to `/app#<id>` */
  readonly id: string
  readonly title: string
  /** One sentence: what the demo shows */
  readonly summary: string
  /** The layer in `AppLayer` (layers.ts) behind this capability, for the layer graph */
  readonly layer?: {
    /** How layers.ts names it, e.g. `RealtimeLive` */
    readonly name: string
    readonly provides: ReadonlyArray<string>
    /** Bindings and settings it reads */
    readonly needs: ReadonlyArray<string>
  }
  /**
   * 10-20 lines each: the `card` region of a file, imported with `?region=card` (see regions.ts),
   * so the card shows the code as it is now. The region is public: it ships to the browser.
   */
  readonly code: ReadonlyArray<CodeFile>
  /** Files to open next, as `[what, path]` */
  readonly files: ReadonlyArray<readonly [string, string]>
  /** The test that swaps in a test layer */
  readonly test: { readonly path: string; readonly name: string }
  /** The AGENTS.md section to read */
  readonly agents: string
  /**
   * Who may use the demo and what that lets them do. `reads` for a demo that changes nothing.
   * `writes` (it stores something) and `spends` (it costs money or sends something out: a model
   * call, an email, a browser container) put a notice on the card: on a project without auth,
   * "Open endpoint." and `open`; with auth, `signedIn`, since anyone can sign up.
   */
  readonly access?:
    | { readonly effect: "reads" }
    | {
        readonly effect: "writes" | "spends"
        /** Without auth: what anyone who can reach the app can do with it, and what to do */
        readonly open: string
        /** With auth: what any signed-in user can do with it, and whose data it is */
        readonly signedIn: string
      }
  /** The working demo. Handle loading, empty, error and not-configured states. */
  readonly Demo: ComponentType
}
