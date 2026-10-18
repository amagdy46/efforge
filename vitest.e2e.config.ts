import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.ts"],
    testTimeout: 15 * 60 * 1000,
    hookTimeout: 15 * 60 * 1000,
  },
})
