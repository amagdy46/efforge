import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { decryptSecret, encryptSecret, loadEncryptionKey } from "../src/llm-crypto"

const keyText = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))

describe("llm-crypto", () => {
  it.effect("round-trips a secret and never stores it in the clear", () =>
    Effect.gen(function* () {
      const key = yield* loadEncryptionKey(keyText)
      const sealed = yield* encryptSecret(key, "sk-secret-1234", "org_1")
      expect(sealed).not.toContain("sk-secret")
      expect(sealed.startsWith("v1.")).toBe(true)
      expect(yield* decryptSecret(key, sealed, "org_1")).toBe("sk-secret-1234")
    }),
  )

  it.effect("uses a fresh IV each time", () =>
    Effect.gen(function* () {
      const key = yield* loadEncryptionKey(keyText)
      const [a, b] = yield* Effect.all(
        [encryptSecret(key, "same", "org_1"), encryptSecret(key, "same", "org_1")],
        { concurrency: "unbounded" },
      )
      expect(a).not.toBe(b)
    }),
  )

  it.effect("refuses a ciphertext moved to another organization or tampered with", () =>
    Effect.gen(function* () {
      const key = yield* loadEncryptionKey(keyText)
      const sealed = yield* encryptSecret(key, "sk-secret", "org_1")
      expect(yield* Effect.flip(decryptSecret(key, sealed, "org_2"))).toMatchObject({
        _tag: "LlmError",
      })
      const parts = sealed.split(".")
      const tampered = `${parts[0]}.${parts[1]}.${btoa("x".repeat(24))}`
      expect(yield* Effect.flip(decryptSecret(key, tampered, "org_1"))).toMatchObject({
        _tag: "LlmError",
      })
    }),
  )

  it.effect("rejects a missing, malformed or wrong-sized key at load time", () =>
    Effect.gen(function* () {
      const errors = yield* Effect.forEach([undefined, "", "not base64!", btoa("short")], (bad) =>
        Effect.flip(loadEncryptionKey(bad)),
      )
      for (const error of errors) expect(error).toMatchObject({ _tag: "LlmConfigError" })
    }),
  )
})
