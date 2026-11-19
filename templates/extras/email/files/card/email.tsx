import { type SubmitEvent, useEffect, useState } from "react"
import { FailureNote, Pending } from "@/components/demo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useServerCall } from "@/lib/use-server-call"
import { useStack } from "@/lib/use-stack"
import { InvalidAddress, MailerError } from "@repo/core/mailer"
import { mailSettings, sendTestEmail } from "@/server/email-demo"
import program from "../../../../packages/core/src/mailer.ts?region=card"
import serverFn from "../server/email-demo.ts?region=card"
import layer from "../server/mailer.ts?region=card"
import type { Capability } from "./types"

// pnpm dev emulates the EMAIL binding: it writes each message to a local file instead
const devBinding = import.meta.env.DEV
  ? " In pnpm dev the binding is emulated: the dev server log says where it wrote the message."
  : ""
const cloudflareNote = import.meta.env.DEV
  ? "In pnpm dev the EMAIL binding is emulated, so nothing is delivered; deployed, messages go out through Cloudflare Email Service."
  : "Messages go out through Cloudflare Email Service, to real inboxes."

/** Send a test email; with the console transport, the card shows what would have gone out. */
function EmailDemo() {
  const settings = useServerCall(mailSettings)
  const sending = useServerCall(sendTestEmail, InvalidAddress, MailerError)
  const [to, setTo] = useState("")
  const stack = useStack()
  const load = settings.run

  useEffect(() => {
    void load()
  }, [load])

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    void sending.run({ data: { to } })
  }

  const file = stack?.infra === "alchemy" ? ".env" : ".dev.vars"

  return (
    <div className="space-y-4">
      <div aria-live="polite">
        {settings.state.status === "idle" || settings.state.status === "running" ? (
          <Pending>Reading the mail settings…</Pending>
        ) : null}
        {settings.state.status === "failed" ? <FailureNote {...settings.state} /> : null}
        {settings.state.status === "done" ? (
          <p className="text-sm text-muted-foreground">
            Transport{" "}
            <code className="font-mono text-foreground">{settings.state.value.transport}</code>,
            from <code className="font-mono text-foreground">{settings.state.value.from}</code>.{" "}
            {settings.state.value.transport === "console" ? (
              <>
                Messages are printed to the dev server log, and nothing leaves this machine. To send
                through Cloudflare Email Service, set{" "}
                <code className="font-mono">MAIL_TRANSPORT=cloudflare</code> and{" "}
                <code className="font-mono">MAIL_FROM</code> to an address on a domain enabled for
                Email Sending in <code className="font-mono">{file}</code>.
              </>
            ) : (
              cloudflareNote
            )}
          </p>
        ) : null}
      </div>
      <form onSubmit={submit} className="space-y-2">
        <Label htmlFor="email-to">To</Label>
        <div className="flex gap-2">
          <Input
            id="email-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="you@example.com"
            inputMode="email"
            autoComplete="email"
            maxLength={320}
          />
          <Button type="submit" disabled={to.trim() === "" || sending.state.status === "running"}>
            Send a test email
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Type something that is not an address to see{" "}
          <code className="font-mono">InvalidAddress</code> come back.
        </p>
      </form>
      <div aria-live="polite">
        {sending.state.status === "running" ? <Pending>Sending…</Pending> : null}
        {sending.state.status === "failed" ? <FailureNote {...sending.state} /> : null}
        {sending.state.status === "done" ? (
          <div className="space-y-2">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border bg-background p-3 text-sm">
              <dt className="text-muted-foreground">From</dt>
              <dd className="break-words">{sending.state.value.from}</dd>
              <dt className="text-muted-foreground">To</dt>
              <dd className="break-words">{sending.state.value.to}</dd>
              <dt className="text-muted-foreground">Subject</dt>
              <dd className="font-medium">{sending.state.value.subject}</dd>
              <dd className="col-span-2 mt-1 border-t pt-2 whitespace-pre-wrap">
                {sending.state.value.text}
              </dd>
            </dl>
            <p className="text-xs text-muted-foreground">
              {sending.state.value.transport === "console"
                ? "Printed to the dev server log by the console transport, through the Mailer service."
                : `Handed to the EMAIL binding by the Mailer service.${devBinding}`}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const email: Capability = {
  id: "email",
  title: "Email",
  summary:
    "Transactional email through the Mailer service: printed to the log in development, sent by Cloudflare Email Service in production.",
  layer: {
    name: "MailerLive",
    provides: ["Mailer"],
    needs: ["EMAIL send_email binding", "MAIL_FROM", "MAIL_TRANSPORT"],
  },
  code: [
    { path: "packages/core/src/mailer.ts", source: program },
    { path: "apps/web/src/server/email-demo.ts", source: serverFn },
    { path: "apps/web/src/server/mailer.ts", source: layer },
  ],
  files: [
    ["Service and program", "packages/core/src/mailer.ts"],
    ["Layer and transports", "apps/web/src/server/mailer.ts"],
  ],
  test: {
    path: "packages/core/test/mailer.test.ts",
    name: "refuses something that is not an address with InvalidAddress and sends nothing",
  },
  agents: "Email",
  access: {
    effect: "spends",
    open: "This project has no auth, so anyone who can reach the app can send a test email from it. Add auth or remove the demo before you deploy it.",
    signedIn:
      "Any account can send the test email from your sender address. Sign-up is open to anyone until you close it (AGENTS.md, Auth). Close it, or remove this demo, before you deploy with MAIL_TRANSPORT=cloudflare.",
  },
  Demo: EmailDemo,
}
