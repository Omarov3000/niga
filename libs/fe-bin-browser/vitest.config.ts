import { defineConfig } from 'vitest/config'

export default defineConfig({
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  test: {
    browser: {
      provider: 'playwright', // or 'webdriverio'
      enabled: true,
      // at least one instance is required
      instances: [{ browser: 'chromium' }],
      fileParallelism: !process.env.CI,
    },
    retry: process.env.CI ? 2 : 1,
    testTimeout: process.env.CI ? 12_000 : 6_000,
    globals: true,
  },
})
