import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { AppShell } from "@/components/app-shell"
import { OrgSwitcher } from "@/components/org-switcher"
import { UserMenu } from "@/components/user-menu"
import { getAppState } from "@/server/session"

export const Route = createFileRoute("/app")({
  beforeLoad: async () => {
    const state = await getAppState()
    if (state === null) throw redirect({ to: "/sign-in" })
    // first sign-in: nothing to work in yet, so create an organization
    if (state.organizations.length === 0) throw redirect({ to: "/onboarding" })
    return state
  },
  component: AppLayout,
})

function AppLayout() {
  const { session, organizations } = Route.useRouteContext()
  return (
    <AppShell
      sidebar={
        <OrgSwitcher organizations={organizations} activeId={session.activeOrganizationId} />
      }
      account={<UserMenu name={session.name} email={session.email} />}
    >
      <Outlet />
    </AppShell>
  )
}
