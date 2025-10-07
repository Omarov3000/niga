import type { OnlineDetector } from './types'

export class NetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'NetworkError'
  }
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  onlineDetector: OnlineDetector,
  maxRetries = 5,
  delayFactor = 1000 // Default 1s base delay, can be reduced for tests
): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check if we're offline before attempting
    if (!onlineDetector.online) {
      throw new NetworkError('Offline - skipping network operation', lastError)
    }

    try {
      return await fn()
    } catch (error) {
      lastError = error

      // If this was the last retry, throw
      if (attempt === maxRetries) {
        throw new NetworkError(`Network operation failed after ${maxRetries + 1} attempts`, error)
      }

      // Exponential backoff with configurable delay factor
      const delayMs = Math.pow(2, attempt) * delayFactor
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new NetworkError('Network operation failed', lastError)
}
