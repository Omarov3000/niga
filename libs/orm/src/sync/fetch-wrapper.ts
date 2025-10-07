import type { OnlineDetector } from './types'

/**
 * Creates a fetch wrapper that handles:
 * - Waiting for online before making requests
 * - Exponential backoff with retries
 * - Never giving up (infinite retries)
 */
export function createFetchWrapper(
  baseFetch: (url: string, options: RequestInit) => Promise<Response>,
  onlineDetector: OnlineDetector
): (url: string, options: RequestInit) => Promise<Response> {
  return async (url: string, options: RequestInit): Promise<Response> => {
    let attempt = 0

    while (true) {
      // Wait for online if we're offline
      if (!onlineDetector.online) {
        await onlineDetector.waitForOnline()
      }

      try {
        return await baseFetch(url, options)
      } catch (error) {
        // Calculate backoff delay: 1s, 2s, 4s, 8s, 16s (capped at 16s)
        const delayMs = Math.min(Math.pow(2, attempt) * 1000, 16000)

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delayMs))

        attempt++
        // Continue to next iteration (never give up)
      }
    }
  }
}
