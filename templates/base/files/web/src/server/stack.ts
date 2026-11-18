import { createServerFn } from "@tanstack/react-start"
import { capabilities } from "@/capabilities/registry"
import { stack } from "./manifest"

/** The stack from efforge.jsonc and the ids of the dashboard's cards, for the landing page. */
export const getStack = createServerFn({ method: "GET" }).handler(() => ({
  stack,
  cards: capabilities.map((capability) => capability.id),
}))
