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
  /** 10-20 lines each, imported with `?raw` so the card shows the code as it is now */
  readonly code: ReadonlyArray<CodeFile>
  /** Files to open next, as `[what, path]` */
  readonly files: ReadonlyArray<readonly [string, string]>
  /** The test that swaps in a test layer */
  readonly test: { readonly path: string; readonly name: string }
  /** The AGENTS.md section to read */
  readonly agents: string
  /** The working demo. Handle loading, empty, error and not-configured states. */
  readonly Demo: ComponentType
}
