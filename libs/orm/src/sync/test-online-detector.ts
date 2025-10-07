import type { OnlineDetector } from './types'

export class AlwaysOnlineDetector implements OnlineDetector {
  online = true

  onOnlineChange(_callback: (online: boolean) => void): void {
    // no-op - always online, never changes
  }
}

export class ControllableOnlineDetector implements OnlineDetector {
  online = true
  private callbacks: Array<(online: boolean) => void> = []

  onOnlineChange(callback: (online: boolean) => void): void {
    this.callbacks.push(callback)
  }

  setOnline(value: boolean): void {
    if (this.online === value) return
    this.online = value
    this.callbacks.forEach(cb => cb(value))
  }
}
