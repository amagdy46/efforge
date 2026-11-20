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
