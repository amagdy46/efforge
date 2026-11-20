import { Context, Effect, Layer } from "effect"
import { D1 } from "effect-cf"
import type { AuthSettings } from "./auth"

/** The `DB` binding, read for Better Auth's own client. */
class AuthD1 extends D1.Service<AuthD1>()("AuthD1", { binding: "DB" }) {}

/** Better Auth's database. It queries through Kysely, which has a built-in D1 dialect, so the binding is passed as is. */
export class AuthDatabase extends Context.Service<
  AuthDatabase,
  { readonly database: AuthSettings["database"] }
>()("AuthDatabase") {}

export const AuthDatabaseLayer = Layer.effect(
  AuthDatabase,
  Effect.map(AuthD1, (d1) => ({ database: d1 })),
).pipe(Layer.provide(AuthD1.layer))
