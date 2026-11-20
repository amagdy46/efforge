import { useEffect, useState } from "react"
import { getStack } from "@/server/stack"
import type { Stack } from "./stack"

let request: Promise<Stack> | undefined

/**
 * The project's stack (`efforge.jsonc`), for a card that words a state by it, such as "this
 * project has no auth". Asked once per page load, however many cards use it.
 */
export function useStack(): Stack | undefined {
  const [stack, setStack] = useState<Stack>()
  useEffect(() => {
    let live = true
    request ??= getStack().then((result) => result.stack)
    request.then(
      (value) => {
        if (live) setStack(value)
      },
      () => {
        request = undefined
      },
    )
    return () => {
      live = false
    }
  }, [])
  return stack
}
