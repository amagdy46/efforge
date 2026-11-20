import { ManagedRuntime } from "effect"
import { AppLayer } from "./layers"
import { checkSettings } from "./settings"

/**
 * One runtime per Worker isolate; server functions run their Effects on it. A missing setting
 * fails every call with `NotConfigured` (see settings.ts).
 */
export const runtime = ManagedRuntime.make(checkSettings(AppLayer))
