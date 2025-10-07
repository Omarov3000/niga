import type { RemoteDbServer } from './remote-db'

export interface UnstableNetworkConfig {
  failPattern?: number[] // [0,1,0] = fail, succeed, fail (0 = fail, 1 = succeed)
  delayMs?: number // Add delay to all requests
  failAfterCalls?: number // Fail after N successful calls
}

export class UnstableNetworkFetch {
  private callCount = 0

  constructor(
    private server: RemoteDbServer,
    private config: UnstableNetworkConfig = {}
  ) {}

  async fetch(url: string, options: RequestInit): Promise<Response> {
    this.callCount++

    // Check fail pattern
    if (this.config.failPattern) {
      const patternIndex = (this.callCount - 1) % this.config.failPattern.length
      const shouldSucceed = this.config.failPattern[patternIndex] === 1
      if (!shouldSucceed) {
        throw new Error('Network error (simulated)')
      }
    }

    // Check failAfterCalls
    if (this.config.failAfterCalls && this.callCount > this.config.failAfterCalls) {
      throw new Error('Network error (simulated - after N calls)')
    }

    // Add delay if configured
    if (this.config.delayMs) {
      await new Promise(resolve => setTimeout(resolve, this.config.delayMs))
    }

    // Execute actual request
    return await this.server.handleRequest(url, options.method || 'GET', options.body as string | undefined)
  }

  getCallCount(): number {
    return this.callCount
  }

  resetCallCount(): void {
    this.callCount = 0
  }

  setConfig(config: UnstableNetworkConfig): void {
    this.config = config
  }
}
