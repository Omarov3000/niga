import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 1000,
    isolate: false,
    pool: 'threads', // https://vitest.dev/config/#vmthreads https://github.com/vitest-dev/vitest/pull/3203#issue-1672015154
    poolOptions: {
      threads: {
        execArgv: ['--no-warnings=ExperimentalWarning'],
      }
    },
  },
});
