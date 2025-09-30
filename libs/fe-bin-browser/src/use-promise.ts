import { safe } from './utils'

// based on https://react.dev/reference/react/Suspense#showing-stale-content-while-fresh-content-is-loading and https://blixtdev.com/all-about-reacts-new-use-hook/
// export function usePromise<T>(key: Key, factory: () => Promise<T>): T {
//   const stringKey = String(key)
//   if (!cachedPromises.has(stringKey)) cachedPromises.set(stringKey, { status: 'initial', promise: factory() })
//   return useP(cachedPromises.get(stringKey) as SuspensePromiseWrapper<T>)
// }
// type Key = Array<string | number> | string | number

// export const clearCachedPromise = (key: Key) => cachedPromises.delete(String(key))

// When promise resolves, React replays component's render. During this the (2nd) use call returns fulfilled value without caching react suspends on every render -> endless loop. caching makes use to be exempt from all rules of hooks
// const cachedPromises = new Map<string, SuspensePromiseWrapper<a>>()

// discriminator not possible to use here (due to mutations)
export interface SuspensePromiseWrapper<T> {
  status: 'pending' | 'fulfilled' | 'rejected' | 'initial'
  value?: T
  error?: Error
  promise: Promise<T>
}

export function usePromiseWrapper<T>(wrapper: SuspensePromiseWrapper<T>): T {
  if (wrapper.status === 'fulfilled') return safe(wrapper.value)
  if (wrapper.status === 'rejected') throw wrapper.error
  if (wrapper.status === 'pending') throw wrapper.promise

  wrapper.status = 'pending'
  wrapper.promise
    .then((result) => {
      if (result instanceof Error) throw result // useQuery catches errors and returns them as data
      wrapper.status = 'fulfilled'
      wrapper.value = result
    })
    .catch((error) => {
      wrapper.status = 'rejected'
      wrapper.error = error instanceof Error ? error : new Error(error)
    })

  throw wrapper.promise
}

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
type a = any
