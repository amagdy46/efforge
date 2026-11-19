import { getRouteApi } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { FailureNote, Pending } from "@/components/demo"
import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"
import { useServerCall } from "@/lib/use-server-call"
import { whoAmI } from "@/server/account"
import service from "../../../../packages/core/src/Auth.ts?region=card"
import serverFn from "../server/account.ts?region=card"
import middleware from "../server/require-session.ts?region=card"
import type { Capability } from "./types"

const app = getRouteApi("/app")

async function signOut() {
  await authClient.signOut()
  window.location.assign("/sign-in")
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2 px-3 py-2 text-sm">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function AuthDemo() {
  const { session } = app.useRouteContext()
  const { state, run } = useServerCall(whoAmI)
  return (
    <div className="space-y-4">
      <dl className="divide-y rounded-md border bg-background">
        <Fact term="Signed in as">
          <span className="font-medium">{session.name}</span>
        </Fact>
        <Fact term="Email">{session.email}</Fact>
        <Fact term="User id">
          <code className="font-mono text-xs">{session.userId}</code>
        </Fact>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void run()} disabled={state.status === "running"}>
          Call a protected server function
        </Button>
        <Button variant="outline" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
      <div aria-live="polite">
        {state.status === "running" ? <Pending>Calling whoAmI…</Pending> : null}
        {state.status === "failed" ? <FailureNote error={state.error} /> : null}
        {state.status === "done" ? (
          <p className="rounded-md border bg-background p-3 text-sm">
            <code className="font-mono">requireSession</code> let the call through for{" "}
            <span className="font-medium">{state.value.email}</span> at{" "}
            {new Date(state.value.checkedAt).toLocaleTimeString()}. Signed out, it rejects the call
            before the handler runs.
          </p>
        ) : null}
      </div>
    </div>
  )
}

export const auth: Capability = {
  id: "auth",
  title: "Auth",
  summary:
    "Better Auth behind the Auth service: code reads the session from Auth.currentSession, never from cookies.",
  layer: { name: "AuthLive", provides: ["Auth", "BetterAuth"], needs: ["BETTER_AUTH_SECRET"] },
  code: [
    { path: "apps/web/src/server/account.ts", source: serverFn },
    { path: "apps/web/src/server/require-session.ts", source: middleware },
    { path: "packages/core/src/Auth.ts", source: service },
  ],
  files: [
    ["Service", "packages/core/src/Auth.ts"],
    ["Layer", "apps/web/src/server/auth-live.ts"],
  ],
  test: { path: "packages/core/test/auth.test.ts", name: "sessionOrNull is null" },
  agents: "Auth (Better Auth)",
  access: { effect: "reads" },
  Demo: AuthDemo,
}
