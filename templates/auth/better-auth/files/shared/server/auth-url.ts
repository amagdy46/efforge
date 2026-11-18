/** BETTER_AUTH_URL's value in .env.example, which means "not set yet". */
const EXAMPLE_URL = "https://app.example.com"

/** Under `pnpm dev`: the origin of each request on a local host, whatever port Vite picks. */
const LOCAL = { allowedHosts: ["localhost:*", "127.0.0.1:*"], protocol: "http" as const }

/**
 * Better Auth's `baseURL`. BETTER_AUTH_URL wins whenever it is set. Unset (or still the example
 * value), `pnpm dev` takes the origin from each request on a local host, and a deployed Worker
 * lets Better Auth infer it.
 */
export const authBaseURL = (configured: string | undefined, dev: boolean) => {
  const url = configured === "" || configured === EXAMPLE_URL ? undefined : configured
  return url === undefined && dev ? LOCAL : url
}
