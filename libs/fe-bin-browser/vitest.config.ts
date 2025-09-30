import { PluginOption } from 'vite'
import { defineConfig } from 'vitest/config'
// import reactFallbackThrottlePlugin from 'vite-plugin-react-fallback-throttle'

function viteReactFallbackThrottlePlugin(throttleMs = 0): {
  name: string;
  transform: (src: string, id: string) => { code: string; map: null } | null;
} {
  return {
    name: 'vite-plugin-react-fallback-throttle',
    transform(src, id) {
      // Filter logic moved to handler
      const shouldProcess = id.includes('vitest-browser-react') ||
        id.includes('react-dom-client.development.js') ||
                           id.includes('react-dom-profiling.development.js') ||
                           id.includes('react-dom-client.production.js') ||
                           id.includes('react-dom') && id.endsWith('.js');

      if (!shouldProcess) {
        return null; // Don't process this file
      }

      // console.log(`[vite-plugin-react-fallback-throttle] Processing file: ${id}`);

      const originalSrc = src;
      let replacementCount = 0;

      const srcWithReplacedFallbackThrottle = src
        // development
        .replace('FALLBACK_THROTTLE_MS = 300,', (match) => {
          replacementCount++;
          // console.log(`[vite-plugin-react-fallback-throttle] Found development fallback throttle: ${match}`);
          return `FALLBACK_THROTTLE_MS = ${throttleMs},`;
        })
        // production
        .replace(
          '((exitStatus = globalMostRecentFallbackTime + 300 - now())',
          (match) => {
            replacementCount++;
            // console.log(`[vite-plugin-react-fallback-throttle] Found production fallback throttle (1): ${match}`);
            return `((exitStatus = globalMostRecentFallbackTime + ${throttleMs} - now())`;
          },
        )
        .replace(
          '300 > now() - globalMostRecentFallbackTime)',
          (match) => {
            replacementCount++;
            // console.log(`[vite-plugin-react-fallback-throttle] Found production fallback throttle (2): ${match}`);
            return `${throttleMs} > now() - globalMostRecentFallbackTime)`;
          },
        );

      // console.log(`[vite-plugin-react-fallback-throttle] Total replacements made: ${replacementCount}`);

      if (replacementCount === 0) {
        // console.log(`[vite-plugin-react-fallback-throttle] No fallback throttle patterns found in ${id}`);
      }

      const result = {
        code: srcWithReplacedFallbackThrottle,
        map: null,
      };

      return result;
    },
  } satisfies PluginOption;
}

export default defineConfig({
  worker: { format: 'es' },
  plugins: [viteReactFallbackThrottlePlugin()],
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
    include: ['react/jsx-dev-runtime'] // unexpectedly reloaded a test. This may cause tests to fail, lead to flaky behaviour
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
