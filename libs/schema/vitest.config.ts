import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/zod-classic/**",
      "**/zod-core/**",
      "**/.{idea,git,cache,output,temp}/**",
    ],
  },
});
