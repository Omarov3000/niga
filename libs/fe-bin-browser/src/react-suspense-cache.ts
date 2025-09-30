/**
 * A simple cache for storing promises that work with React Suspense.
 * Use with React's `use` hook to read promise values in components.
 *
 * @example
 * ```tsx
 * const cache = new ReactSuspenseCache()
 * cache.put('user', fetchUser())
 *
 * function UserProfile() {
 *   const user = use(cache.get('user')!)
 *   return <div>{user.name}</div>
 * }
 * ```
 */
export class ReactSuspenseCache {
  private cache = new Map<string, Promise<any>>()

  put(key: string, promise: Promise<any>): void {
    this.cache.set(key, promise)
  }

  get(key: string): Promise<any> | undefined {
    return this.cache.get(key)
  }

  has(key: string): boolean {
    return this.cache.has(key)
  }

  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }
}