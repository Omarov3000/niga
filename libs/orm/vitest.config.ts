import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: 'threads', // https://vitest.dev/config/#vmthreads https://github.com/vitest-dev/vitest/pull/3203#issue-1672015154
    isolate: false,
    poolOptions: {
      threads: {
        execArgv: ['--no-warnings=ExperimentalWarning'],
      }
    }
  },
});
