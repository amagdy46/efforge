import { runtime } from "./runtime"
import type { Capability } from "./types"

/** The dashboard's cards, in order. `efforge add` appends each add-on's card to this list. */
export const capabilities: ReadonlyArray<Capability> = [runtime /* efforge:capabilities */]
