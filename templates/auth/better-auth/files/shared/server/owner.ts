import { Auth } from "@repo/core/Auth"
import { Effect } from "effect"

/**
 * Whose data a demo reads and writes: the storage card's uploads, the workflows card's runs.
 * Each signed-in user's are their own; no other user can list, open, delete or watch them. With
 * organizations too, data is per user: to share it within an organization, answer the session's
 * `activeOrganizationId` here instead.
 */
export const currentOwner = Auth.use((auth) => auth.currentSession).pipe(
  Effect.map((session) => session.userId),
)
