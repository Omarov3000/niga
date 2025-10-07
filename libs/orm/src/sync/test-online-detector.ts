import type { OnlineDetector } from './types'

export class AlwaysOnlineDetector implements OnlineDetector {
  online = true

  onOnlineChange(_callback: (online: boolean) => void): void {
    // no-op - always online, never changes
  }

  async waitForOnline(): Promise<void> {
    // no-op - already online
  }
}

export class ControllableOnlineDetector implements OnlineDetector {
  online: boolean
  private callbacks: Array<(online: boolean) => void> = []
  private onlineResolvers: Array<() => void> = []

  constructor(initialOnline = true) {
    this.online = initialOnline
  }

  onOnlineChange(callback: (online: boolean) => void): void {
    this.callbacks.push(callback)
  }

  async waitForOnline(): Promise<void> {
    if (this.online) return
    return new Promise(resolve => {
      this.onlineResolvers.push(resolve)
    })
  }

  setOnline(value: boolean): void {
    if (this.online === value) return
    this.online = value
    this.callbacks.forEach(cb => cb(value))
    if (value) {
      this.onlineResolvers.forEach(resolve => resolve())
      this.onlineResolvers = []
    }
  }
}
