// Better Auth on a cold Worker: starts a generated auth project's server from cold, sends the first
// requests, and counts rounds where any of them got a 5xx or no answer. Two scenarios, the ones
// the w2a2 re-review measured:
//
//   socket-first  a WebSocket upgrade to the realtime room, then two sign-ups at once
//   concurrent    three sign-ups and a page load at once
//
// usage: node scripts/cold-start.ts <project> --server=vite|alchemy|preview [--rounds=20]
//          [--scenario=socket-first|concurrent|both] [--port=5481]
//
// `vite` runs `vite dev` in apps/web, `alchemy` runs the project's `pnpm dev` (`alchemy dev`, which
// uses local providers only and takes no port, so the one it prints is used), and `preview` builds once and serves the build with `vite preview`. The project
// needs auth (sign-up) and, for socket-first, realtime. Each round is a fresh server: it is started,
// the scenario runs, and the server's process group is stopped.
import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { connect } from "node:net"
import { join } from "node:path"
import { parseArgs } from "node:util"

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    server: { type: "string", default: "vite" },
    rounds: { type: "string", default: "20" },
    scenario: { type: "string", default: "both" },
    port: { type: "string", default: "5481" },
  },
})
const project = positionals[0]
const server = values.server
if (project === undefined || !["vite", "alchemy", "preview"].includes(server))
  throw new Error("usage: node scripts/cold-start.ts <project> --server=vite|alchemy|preview")
let port = Number(values.port)
let base = `http://localhost:${port}`
const rounds = Number(values.rounds)
const scenarios =
  values.scenario === "both" ? ["socket-first", "concurrent"] : [values.scenario as string]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Whether something listens on the port, without sending a request (that would warm the Worker). */
const listening = () =>
  new Promise<boolean>((resolve) => {
    const socket = connect(port, "localhost")
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
  })

const start = async (): Promise<ChildProcess> => {
  const [command, args, cwd] =
    server === "alchemy"
      ? ["pnpm", ["dev"], project]
      : server === "preview"
        ? [
            "pnpm",
            ["exec", "vite", "preview", "--port", String(port), "--strictPort"],
            join(project, "apps/web"),
          ]
        : [
            "pnpm",
            ["exec", "vite", "dev", "--port", String(port), "--strictPort"],
            join(project, "apps/web"),
          ]
  const child = spawn(command, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] })
  let log = ""
  child.stdout?.on("data", (d: Buffer) => (log += d.toString()))
  child.stderr?.on("data", (d: Buffer) => (log += d.toString()))
  for (let i = 0; i < 240; i++) {
    // `alchemy dev` takes no port: read the one its Vite server prints
    const printed = server === "alchemy" ? /http:\/\/localhost:(\d+)/.exec(log)?.[1] : String(port)
    if (printed !== undefined) {
      port = Number(printed)
      base = `http://localhost:${port}`
    }
    if (printed !== undefined && (await listening())) {
      // the HTTP server is up; give the dev server a moment to finish wiring its Worker
      await sleep(1500)
      return child
    }
    if (child.exitCode !== null) throw new Error(`the server exited:\n${log.slice(-2000)}`)
    await sleep(250)
  }
  stop(child)
  throw new Error(`nothing listened on ${port}:\n${log.slice(-2000)}`)
}

const stop = (child: ChildProcess) => {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, "SIGTERM")
  } catch {}
}

const waitClosed = async () => {
  for (let i = 0; i < 80 && (await listening()); i++) await sleep(250)
}

let seq = 0
const signUp = async (): Promise<string> => {
  const n = `${Date.now()}-${seq++}`
  const response = await fetch(`${base}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({
      name: "Cold",
      email: `cold-${n}@example.com`,
      password: "correct-horse-battery",
    }),
  })
  const text = await response.text()
  return response.status >= 500 ? `sign-up ${response.status} ${text.slice(0, 160)}` : ""
}

const page = async (): Promise<string> => {
  const response = await fetch(`${base}/`)
  const text = await response.text()
  return response.status >= 500 ? `page ${response.status} ${text.slice(0, 160)}` : ""
}

/** The first request: a WebSocket upgrade, held until the server opens or closes it. */
const socket = () =>
  new Promise<string>((resolve) => {
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws/rooms/demo`)
    const done = (problem: string) => {
      clearTimeout(timer)
      resolve(problem)
      try {
        ws.close()
      } catch {}
    }
    const timer = setTimeout(() => done("socket: no answer in 20 s"), 20_000)
    ws.addEventListener("open", () => done(""))
    ws.addEventListener("close", () => done(""))
    ws.addEventListener("error", () => done(""))
  })

const run = async (scenario: string): Promise<string[]> => {
  const settle = (all: Array<Promise<string>>) =>
    Promise.all(all.map((p) => p.catch((e: unknown) => `no answer: ${String(e)}`)))
  if (scenario === "socket-first") {
    const first = await socket()
    return [first, ...(await settle([signUp(), signUp()]))].filter(Boolean)
  }
  return (await settle([signUp(), signUp(), signUp(), page()])).filter(Boolean)
}

if (server === "preview") {
  const build = spawnSync("pnpm", ["build"], { cwd: project, encoding: "utf8" })
  if (build.status !== 0) throw new Error(`pnpm build failed:\n${build.stdout}${build.stderr}`)
}

const results: Record<string, { failed: number; problems: string[] }> = {}
for (const scenario of scenarios) {
  const result: { failed: number; problems: string[] } = { failed: 0, problems: [] }
  results[scenario] = result
  for (let round = 1; round <= rounds; round++) {
    await waitClosed()
    const child = await start()
    try {
      const problems = await run(scenario)
      if (problems.length > 0) {
        result.failed++
        result.problems.push(`round ${round}: ${problems.join(" | ")}`)
      }
      console.log(
        `${server} ${scenario} round ${round}: ${problems.length === 0 ? "ok" : problems.join(" | ")}`,
      )
    } finally {
      stop(child)
    }
  }
}
await waitClosed()
for (const [scenario, { failed, problems }] of Object.entries(results))
  console.log(
    `${server} ${scenario}: ${failed} of ${rounds} rounds failed${problems.length > 0 ? `\n  ${problems.join("\n  ")}` : ""}`,
  )
process.exitCode = Object.values(results).some((r) => r.failed > 0) ? 1 : 0
