import { Context, Data, Effect } from "effect"

/** The current request has no signed-in user. */
export class Unauthorized extends Data.TaggedError("Unauthorized")<{
  readonly message: string
}> {}

export interface Session {
  readonly userId: string
  readonly email: string
  readonly name: string
  /** The organization the user is working in, or null before they belong to one. */
  readonly activeOrganizationId: string | null
}

// #region card
/** Who is making the current request. Implemented by Better Auth in apps/web/src/server/auth-live.ts. */
export class Auth extends Context.Service<
  Auth,
  { readonly currentSession: Effect.Effect<Session, Unauthorized> }
>()("@repo/core/Auth") {}

/** The signed-in user, or `null` when nobody is. Route guards use it to decide where to send a visitor. */
export const sessionOrNull: Effect.Effect<Session | null, never, Auth> = Auth.use(
  (auth) => auth.currentSession,
).pipe(Effect.catchTag("Unauthorized", () => Effect.succeed(null)))
// #endregion

/** The signed-in user has not picked an organization yet. */
export class NoActiveOrganization extends Data.TaggedError("NoActiveOrganization")<{
  readonly message: string
}> {}

/** The organization the signed-in user works in. Organization-scoped server code starts here. */
export const activeOrganizationId: Effect.Effect<
  string,
  Unauthorized | NoActiveOrganization,
  Auth
> = Auth.use((auth) => auth.currentSession).pipe(
  Effect.flatMap(({ activeOrganizationId: id }) =>
    id === null
      ? Effect.fail(new NoActiveOrganization({ message: "Pick an organization first." }))
      : Effect.succeed(id),
  ),
)
