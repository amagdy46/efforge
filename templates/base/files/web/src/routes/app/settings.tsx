import { createFileRoute } from "@tanstack/react-router"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export const Route = createFileRoute("/app/settings")({ component: Settings })

function Settings() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Placeholder form; wire it to your own server function.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" placeholder="Ada Lovelace" />
          </div>
          <Button onClick={() => toast.success("Saved")}>Save</Button>
        </CardContent>
      </Card>
    </div>
  )
}
