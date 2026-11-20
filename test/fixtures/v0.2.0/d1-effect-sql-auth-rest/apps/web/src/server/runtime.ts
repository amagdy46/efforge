import { ManagedRuntime } from "effect"
import { AppLayer } from "./layers"

/** One runtime per Worker isolate; server functions run their Effects on it. */
export const runtime = ManagedRuntime.make(AppLayer)
