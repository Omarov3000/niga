import type { SuspensePromiseWrapper } from './use-promise'

/**
 * A simple cache for storing promise wrappers that work with React Suspense.
 * Use with `usePromiseWrapper` hook to read promise values in components.
 *
 * @example
 * ```tsx
 * const cache = new ReactSuspenseCache()
 * cache.put('user', { status: 'initial', promise: fetchUser() })
 *
 * function UserProfile() {
 *   const user = usePromiseWrapper(cache.get('user')!)
 *   return <div>{user.name}</div>
 * }
 * ```
 */
export class ReactSuspenseCache {
  private cache = new Map<string, SuspensePromiseWrapper<any>>()

  put<T>(key: string, wrapper: SuspensePromiseWrapper<T>): void {
    this.cache.set(key, wrapper)
  }

  get<T>(key: string): SuspensePromiseWrapper<T> | undefined {
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
