import { readFileSync } from "node:fs"
import { expect, it } from "vitest"

type Transform = { name: string; args: { item?: string; at?: string } }

// A gate that is not first is not a gate: middleware listed before it runs for a signed-out
// caller. `add auth` onto a project that already has its own middleware must put both gates first.
it.each(["better-auth", "better-auth-orgs"])("auth/%s puts both session gates first", (option) => {
  const manifest = JSON.parse(
    readFileSync(new URL(`../templates/auth/${option}/addon.json`, import.meta.url), "utf8"),
  ) as { transforms?: Transform[]; extends?: string }
  const gates = (manifest.transforms ?? []).filter(
    (t) =>
      t.name === "addArrayItem" &&
      (t.args.item === "sessionGate" || t.args.item === "requireApiSession"),
  )
  // better-auth-orgs may reuse better-auth's transforms; when it declares gates, they are first
  if (option === "better-auth") expect(gates).toHaveLength(2)
  for (const gate of gates) expect(gate.args.at, gate.args.item).toBe("start")
})
