import { Layer } from "effect"
import { DbLive } from "./db.ts"

export const AppLayer = Layer.mergeAll(DbLive)
