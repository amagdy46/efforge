import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { drizzle } from "drizzle-orm/d1"
import { Context, Effect, Layer } from "effect"
import { D1 } from "effect-cf"
import * as schema from "@repo/db"
import type { AuthSettings } from "./auth"

/** The `DB` binding, read for Better Auth's own client. */
class AuthD1 extends D1.Service<AuthD1>()("AuthD1", { binding: "DB" }) {}

/**
 * Better Auth's database. It is promise-based, so it gets plain `drizzle-orm/d1` over the D1
 * binding rather than the Effect-flavoured `Database` client.
 */
export class AuthDatabase extends Context.Service<
  AuthDatabase,
  { readonly database: AuthSettings["database"] }
>()("AuthDatabase") {}

export const AuthDatabaseLayer = Layer.effect(
  AuthDatabase,
  Effect.map(AuthD1, (d1) => ({
    database: drizzleAdapter(drizzle(d1), { provider: "sqlite", schema }),
  })),
).pipe(Layer.provide(AuthD1.layer))
