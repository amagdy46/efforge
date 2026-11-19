import { Effect } from "effect"

/**
 * Whose data a demo reads and writes: the storage card's uploads, the workflows card's runs.
 * Without auth there are no users, so every visitor is the same owner and shares them.
 * `efforge add auth` replaces this file with one that answers the signed-in user's id.
 */
export const currentOwner: Effect.Effect<string> = Effect.succeed("everyone")
