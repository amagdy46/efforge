#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { main } from "./cli.ts"
import { PromptIOLive } from "./prompts/navigable.ts"

// `efforge list | head` closes the pipe early: that's the reader being done, not an error.
for (const stream of [process.stdout, process.stderr])
  stream.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EPIPE") process.exit(0)
    throw e
  })

main.pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, PromptIOLive)), NodeRuntime.runMain)
