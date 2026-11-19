import { type SubmitEvent, useCallback, useEffect, useState } from "react"
import { FailureNote, Pending } from "@/components/demo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useServerCall } from "@/lib/use-server-call"
import { addNote, AddNoteErrors, listNotes, ListNotesErrors } from "@/server/notes"
import program from "../../../../packages/core/src/notes.ts?region=card"
import store from "../../../../packages/db/src/notes.ts?region=card"
import serverFns from "../server/notes.ts?region=card"
import type { Capability } from "./types"

function DatabaseDemo() {
  const notes = useServerCall(listNotes, ...ListNotesErrors)
  const adding = useServerCall(addNote, ...AddNoteErrors)
  const [title, setTitle] = useState("")
  const load = notes.run

  useEffect(() => {
    void load()
  }, [load])

  const submit = useCallback(
    (event: SubmitEvent) => {
      event.preventDefault()
      // keep what was typed when the add fails, so it can be fixed and sent again
      void adding.run({ data: { title } }).then((outcome) => {
        if (!outcome.ok) return
        setTitle("")
        void load()
      })
    },
    [adding, load, title],
  )

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-2">
        <Label htmlFor="note-title">New note</Label>
        <div className="flex gap-2">
          <Input
            id="note-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Buy milk"
            maxLength={1000}
          />
          <Button type="submit" disabled={adding.state.status === "running"}>
            Add note
          </Button>
        </div>
      </form>
      {adding.state.status === "failed" ? <FailureNote {...adding.state} /> : null}
      <div aria-live="polite" className="space-y-2">
        <h4 className="text-sm font-medium">Notes</h4>
        {notes.state.status === "idle" || notes.state.status === "running" ? (
          <Pending>Reading the note table…</Pending>
        ) : null}
        {notes.state.status === "failed" ? <FailureNote {...notes.state} /> : null}
        {notes.state.status === "done" && notes.state.value.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet. Add the first one.</p>
        ) : null}
        {notes.state.status === "done" && notes.state.value.length > 0 ? (
          <ul className="max-h-52 divide-y overflow-y-auto rounded-md border bg-background">
            {notes.state.value.map((note) => (
              <li
                key={note.id}
                className="flex items-baseline justify-between gap-4 px-3 py-2 text-sm"
              >
                <span className="min-w-0 break-words">{note.title}</span>
                <time
                  dateTime={new Date(note.createdAt).toISOString()}
                  className="shrink-0 text-xs text-muted-foreground tabular-nums"
                >
                  {new Date(note.createdAt).toLocaleString(undefined, {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </time>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

export const database: Capability = {
  id: "database",
  title: "Database",
  summary:
    "Notes are stored through the Notes service, which packages/db implements on the Database service.",
  layer: { name: "DatabaseLayer", provides: ["Database", "Notes"], needs: ["database binding"] },
  code: [
    { path: "packages/core/src/notes.ts", source: program },
    { path: "packages/db/src/notes.ts", source: store },
    { path: "apps/web/src/server/notes.ts", source: serverFns },
  ],
  files: [
    ["Service and program", "packages/core/src/notes.ts"],
    ["Layer", "packages/db/src/layer.ts"],
  ],
  test: { path: "packages/core/test/notes.test.ts", name: "stores the trimmed title" },
  agents: "Database",
  access: {
    effect: "writes",
    open: "This project has no auth, so anyone who can reach the app can add notes, and every visitor reads them. Add auth before you deploy it.",
    signedIn:
      "Notes are shared on purpose: every user reads and adds to the same list. Sign-up is open to anyone until you close it (AGENTS.md, Auth).",
  },
  Demo: DatabaseDemo,
}
