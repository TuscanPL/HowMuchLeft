import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The integration test talks to the shared local database.
    fileParallelism: false,
    testTimeout: 20_000,
  },
})
