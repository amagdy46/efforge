import { expect, it } from "vitest"
import { available, slots } from "../src/slots.ts"
import { withDefaults } from "../src/stack.ts"
import { stacks } from "./e2e/stacks.ts"

/*
 * Every add-on the rules allow on a database is generated, installed and gated on that database by
 * some e2e case. `cluster` was allowed on Postgres and built only on D1, and failed its gate there.
 */
it("the e2e matrix builds every extra and AI add-on on every database that allows it", () => {
  const built = stacks.map(([, partial]) => withDefaults(partial))
  const databases = slots.find((s) => s.id === "database")?.options.map((o) => o.id) ?? []
  expect(databases).toEqual(["postgres", "d1", "none"])
  const missing: string[] = []
  for (const database of databases) {
    const allowed = { runtime: "cloudflare" as const, database }
    for (const extra of available("extras", allowed).map((o) => o.id))
      if (!built.some((s) => s.database === database && s.extras.includes(extra)))
        missing.push(`extras/${extra} on ${database}`)
    for (const ai of available("ai", allowed).map((o) => o.id))
      if (ai !== "none" && !built.some((s) => s.database === database && s.ai === ai))
        missing.push(`ai/${ai} on ${database}`)
  }
  expect(missing).toEqual([])
})
