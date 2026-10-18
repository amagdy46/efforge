#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { main } from "./cli.ts"
import { PromptIOLive } from "./prompts/navigable.ts"

main.pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, PromptIOLive)), NodeRuntime.runMain)
