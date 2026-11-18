import { Link } from "@tanstack/react-router"
import { LayoutDashboard, Settings } from "lucide-react"
import type { ReactNode } from "react"
import { ThemeToggle } from "@/components/theme-toggle"
import { PROJECT_NAME } from "@/lib/project"

const nav = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/settings", label: "Settings", icon: Settings },
] as const

function ProjectLink() {
  return (
    <Link to="/" className="flex min-w-0 items-center gap-2 rounded-md font-semibold">
      <img src="/favicon.svg" alt="" className="size-6 shrink-0" />
      <span className="truncate">{PROJECT_NAME}</span>
    </Link>
  )
}

function NavLinks({ compact }: { compact: boolean }) {
  return nav.map(({ to, label, icon: Icon }) => (
    <Link
      key={to}
      to={to}
      activeOptions={{ exact: to === "/app" }}
      className={
        compact
          ? "rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground [&.active]:bg-accent [&.active]:text-accent-foreground"
          : "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground [&.active]:bg-accent [&.active]:font-medium [&.active]:text-accent-foreground"
      }
    >
      {compact ? null : <Icon aria-hidden className="size-4" />}
      {label}
    </Link>
  ))
}

/**
 * The signed-in part of the app: a sidebar on wide screens, a top bar on narrow ones. `sidebar`
 * holds extra controls (the organization switcher), `account` the user menu.
 */
export function AppShell({
  sidebar,
  account,
  children,
}: {
  sidebar?: ReactNode
  account?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col gap-6 border-r bg-muted/40 p-4 lg:flex">
        <ProjectLink />
        {sidebar}
        <nav aria-label="App" className="flex flex-col gap-1">
          <NavLinks compact={false} />
        </nav>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/90 px-4 py-2.5 backdrop-blur lg:px-8">
          <div className="lg:hidden">
            <ProjectLink />
          </div>
          <nav aria-label="App" className="flex gap-1 lg:hidden">
            <NavLinks compact />
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {account}
          </div>
        </header>
        {sidebar === undefined ? null : (
          <div className="border-b px-4 py-2 lg:hidden">{sidebar}</div>
        )}
        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  )
}
