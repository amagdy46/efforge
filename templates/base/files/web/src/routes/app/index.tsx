import { createFileRoute } from "@tanstack/react-router"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { widgets } from "@/components/widgets"
import { getGreeting } from "@/server/greeting"

export const Route = createFileRoute("/app/")({
  loader: () => getGreeting(),
  component: Dashboard,
})

function Dashboard() {
  const greeting = Route.useLoaderData()
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <Card>
        <CardHeader>
          <CardTitle>{greeting}</CardTitle>
          <CardDescription>
            This text came from a server function running an Effect on the app runtime.
          </CardDescription>
        </CardHeader>
      </Card>
      {widgets}
    </div>
  )
}
