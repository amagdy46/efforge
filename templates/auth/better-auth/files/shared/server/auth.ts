import { type BetterAuthOptions, betterAuth } from "better-auth"

export interface AuthSettings {
  readonly database: NonNullable<BetterAuthOptions["database"]>
  readonly secret: string
  readonly baseURL: string | undefined
}

/**
 * Better Auth for one request scope (see auth-live.ts). `efforge add` appends plugins to the
 * `plugins` list, so keep the `plugins: [...]` array shape.
 */
export const makeAuth = ({ database, secret, baseURL }: AuthSettings) =>
  betterAuth({
    database,
    secret,
    ...(baseURL === undefined ? {} : { baseURL }),
    emailAndPassword: { enabled: true },
    plugins: [/* efforge:auth-plugins */],
  })

export type AuthInstance = ReturnType<typeof makeAuth>
