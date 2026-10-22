import { Effect, Schema } from "effect"
import { available, slots, whyUnavailable } from "./slots.ts"
import { SlotId, type StackConfig } from "./stack.ts"

export class IncompatibleStack extends Schema.TaggedError<IncompatibleStack>()(
  "IncompatibleStack",
  {
    slot: SlotId,
    value: Schema.String,
    allowed: Schema.Array(Schema.String),
    /** extra explanation (e.g. why `add` can't change a slot) */
    reason: Schema.optionalKey(Schema.String),
  },
) {}

/** Checks every slot value against `available` given the other choices. */
export const validate = (config: StackConfig): Effect.Effect<StackConfig, IncompatibleStack> =>
  Effect.gen(function* () {
    for (const slot of slots) {
      const allowed = available(slot.id, config).map((o) => o.id)
      const values = slot.id === "extras" ? config.extras : [config[slot.id]]
      for (const value of values) {
        if (!allowed.includes(value)) {
          const reason = whyUnavailable(slot.id, value, config)
          return yield* new IncompatibleStack(
            reason === undefined
              ? { slot: slot.id, value, allowed }
              : { slot: slot.id, value, allowed, reason },
          )
        }
      }
    }
    return config
  })
