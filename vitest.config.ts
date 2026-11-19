import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/e2e/**", "node_modules/**"],
    // Many tests generate a whole project in memory; they take under a second alone and several
    // times that when the machine is busy (other suites, a CI neighbour). Vitest's 5 s default
    // then fails tests that are fine.
    testTimeout: 30_000,
  },
})
