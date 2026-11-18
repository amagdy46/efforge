import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { AppShell } from "@/components/app-shell"
import { UserMenu } from "@/components/user-menu"
import { getSession } from "@/server/session"

export const Route = createFileRoute("/app")({
  beforeLoad: async () => {
    const session = await getSession()
    if (session === null) throw redirect({ to: "/sign-in" })
    return { session }
  },
  component: AppLayout,
})

function AppLayout() {
  const { session } = Route.useRouteContext()
  return (
    <AppShell account={<UserMenu name={session.name} email={session.email} />}>
      <Outlet />
    </AppShell>
  )
}
