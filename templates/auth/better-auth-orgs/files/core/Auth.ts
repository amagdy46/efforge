import { Context, Effect, Schema } from "effect"

/** The current request has no signed-in user. */
export class Unauthorized extends Schema.TaggedError<
  Unauthorized,
  { readonly brand: unique symbol }
>()("Unauthorized", { message: Schema.String }) {}

export interface Session {
  readonly userId: string
  readonly email: string
  readonly name: string
  /** The organization the user is working in, or null before they belong to one. */
  readonly activeOrganizationId: string | null
}

// #region card
/** Who is making the request. Better Auth implements it (auth-live.ts). */
export class Auth extends Context.Service<
  Auth,
  { readonly currentSession: Effect.Effect<Session, Unauthorized> }
>()("@repo/core/Auth") {}

/** The signed-in user, or `null`. Route guards use it to pick a page. */
export const sessionOrNull = Auth.use((auth) => auth.currentSession).pipe(
  Effect.catchTag("Unauthorized", () => Effect.succeed(null)),
)
// #endregion

/** The signed-in user has not picked an organization yet. */
export class NoActiveOrganization extends Schema.TaggedError<
  NoActiveOrganization,
  { readonly brand: unique symbol }
>()("NoActiveOrganization", { message: Schema.String }) {}

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
