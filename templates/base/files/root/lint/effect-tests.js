// Effect tests run through @effect/vitest (`it.effect`, `it.layer`), which supplies the test
// services and reports failures with their full cause. Running an Effect by hand skips both.
const runners = new Set([
  "runCallback",
  "runFork",
  "runPromise",
  "runPromiseExit",
  "runSync",
  "runSyncExit",
])

const manualRunner = (callee) => {
  if (callee.type !== "MemberExpression" || callee.object.type !== "Identifier") return undefined
  if (callee.property.type !== "Identifier") return undefined
  const object = callee.object.name
  const method = callee.property.name
  if (object === "Effect" && runners.has(method)) return `Effect.${method}`
  if (object === "ManagedRuntime" && method === "make") return "ManagedRuntime.make"
  return undefined
}

export default {
  meta: { name: "effect-tests" },
  rules: {
    "no-manual-runtime": {
      meta: {
        type: "problem",
        docs: {
          description: "Run Effects in tests with it.effect or it.layer from @effect/vitest",
        },
        messages: {
          manual: "{{name}} in a test: use it.effect or it.layer from @effect/vitest instead.",
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            const name = manualRunner(node.callee)
            if (name !== undefined) context.report({ node, messageId: "manual", data: { name } })
          },
        }
      },
    },
  },
}
