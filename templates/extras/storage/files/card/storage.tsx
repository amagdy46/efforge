import { ExternalLink } from "lucide-react"
import { type SubmitEvent, useCallback, useEffect, useRef, useState } from "react"
import { FailureNote, Pending } from "@/components/demo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useServerCall } from "@/lib/use-server-call"
import { deleteFile, listFiles, uploadFile } from "@/server/storage-demo"
import program from "../../../../packages/core/src/storage.ts?region=card"
import serverFn from "../server/storage-demo.ts?region=card"
import layer from "../server/storage.ts?region=card"
import type { Capability } from "./types"

/** A file as base64, the way the upload server function takes it. */
const readBase64 = async (file: File) => {
  let binary = ""
  for (const byte of new Uint8Array(await file.arrayBuffer())) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const formatSize = (bytes: number) =>
  bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} KB`

/** Upload a file to R2, list the bucket, open a file through a signed link, delete it. */
function StorageDemo() {
  const files = useServerCall(listFiles)
  const adding = useServerCall(uploadFile)
  const removing = useServerCall(deleteFile)
  const [file, setFile] = useState<File | undefined>()
  const input = useRef<HTMLInputElement>(null)
  const load = files.run

  useEffect(() => {
    void load()
  }, [load])

  const submit = useCallback(
    (event: SubmitEvent) => {
      event.preventDefault()
      if (file === undefined) return
      void readBase64(file)
        .then((bytes) => adding.run({ data: { name: file.name, type: file.type, bytes } }))
        .then((outcome) => {
          // keep the chosen file when the upload fails, so it can be sent again
          if (!outcome.ok) return
          setFile(undefined)
          if (input.current !== null) input.current.value = ""
          void load()
        })
    },
    [adding, file, load],
  )

  const remove = (key: string) =>
    void removing.run({ data: { key } }).then((outcome) => {
      if (outcome.ok) void load()
    })

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-2">
        <Label htmlFor="storage-file">File to upload</Label>
        <div className="flex gap-2">
          <Input
            ref={input}
            id="storage-file"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0])}
          />
          <Button type="submit" disabled={file === undefined || adding.state.status === "running"}>
            Upload
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Pick one over 1 MB to see the <code className="font-mono">FileTooLarge</code> error come
          back.
        </p>
      </form>
      <div aria-live="polite" className="space-y-2">
        {adding.state.status === "running" ? <Pending>Uploading to R2…</Pending> : null}
        {adding.state.status === "failed" ? <FailureNote error={adding.state.error} /> : null}
        {adding.state.status === "done" ? (
          <p className="text-sm text-muted-foreground">
            Stored {formatSize(adding.state.value.size)} under a key the server made, through the{" "}
            <code className="font-mono">Storage</code> service.
          </p>
        ) : null}
        {removing.state.status === "failed" ? <FailureNote error={removing.state.error} /> : null}
      </div>
      <div aria-live="polite" className="space-y-2">
        <h4 className="text-sm font-medium">
          Files in <code className="font-mono font-normal">uploads/</code>
        </h4>
        {files.state.status === "idle" || files.state.status === "running" ? (
          <Pending>Listing the bucket…</Pending>
        ) : null}
        {files.state.status === "failed" ? <FailureNote error={files.state.error} /> : null}
        {files.state.status === "done" && files.state.value.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files yet. Upload the first one.</p>
        ) : null}
        {files.state.status === "done" && files.state.value.length > 0 ? (
          <ul className="max-h-52 divide-y overflow-y-auto rounded-md border bg-background">
            {files.state.value.map((f) => (
              <li key={f.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  <span className="truncate">{f.name}</span>
                  <ExternalLink aria-hidden className="size-3.5 shrink-0" />
                </a>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatSize(f.size)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Delete ${f.name}`}
                  disabled={removing.state.status === "running"}
                  onClick={() => remove(f.key)}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {files.state.status === "done" && files.state.value.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Each link is signed for ten minutes and served by the Worker&apos;s{" "}
            <code className="font-mono">/files/</code> route.
          </p>
        ) : null}
      </div>
    </div>
  )
}

export const storage: Capability = {
  id: "storage",
  title: "Storage",
  summary:
    "Files in an R2 bucket behind the Storage service; the Worker serves each one through a signed link.",
  layer: {
    name: "StorageLive",
    provides: ["Storage"],
    needs: ["STORAGE R2 bucket", "STORAGE_SIGNING_SECRET"],
  },
  code: [
    { path: "packages/core/src/storage.ts", source: program },
    { path: "apps/web/src/server/storage-demo.ts", source: serverFn },
    { path: "apps/web/src/server/storage.ts", source: layer },
  ],
  files: [
    ["Service and program", "packages/core/src/storage.ts"],
    ["Download route", "apps/web/src/server/storage-route.ts"],
  ],
  test: {
    path: "packages/core/test/storage.test.ts",
    name: "refuses a file over 1 MB with FileTooLarge and stores nothing",
  },
  agents: "Storage",
  access: {
    effect: "writes",
    open: "This project has no auth, so anyone who can reach the app can upload files, open them and delete them, and every visitor shares one list. Add auth before you deploy it.",
    signedIn:
      "Each user lists, opens and deletes only their own uploads (under uploads/<user id>/), and each may store files up to 1 MB. Sign-up is open to anyone until you close it (AGENTS.md, Auth).",
  },
  Demo: StorageDemo,
}
