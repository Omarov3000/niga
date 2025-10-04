import type { AnyRouter, AnyProcedure } from '../core/types'

type CreateClientRouter<TRouter extends AnyRouter> = {
  [K in keyof TRouter]: TRouter[K] extends AnyProcedure
    ? {
        query: TRouter[K]['_types']['query']
        mutate: TRouter[K]['_types']['mutate']
      }
    : TRouter[K] extends AnyRouter
    ? CreateClientRouter<TRouter[K]>
    : never
}

export interface RpcClientConfig {
  url: string
  headers?: Record<string, string>
  fetch?: typeof fetch
}

export function createRpcClient<TRouter extends AnyRouter>(
  config: RpcClientConfig
): CreateClientRouter<TRouter> {
  const fetchFn = config.fetch || globalThis.fetch

  const executeRequest = async (path: string, input: any, type: 'query' | 'mutation') => {
    const url = `${config.url}/${path}`
    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify({ input, type }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Request failed' }))
      throw new Error(errorData.message || `HTTP ${response.status}`)
    }

    const result = await response.json()

    if (!result.ok) {
      throw new Error(result.error?.message || 'Request failed')
    }

    return result.data
  }

  const buildProxy = (basePath: string[] = []): any => {
    return new Proxy(
      {},
      {
        get(_target, prop: string) {
          const currentPath = [...basePath, prop]

          return new Proxy(
            {},
            {
              get(_innerTarget, method: string) {
                if (method === 'query' || method === 'mutate') {
                  return (input: any) => executeRequest(currentPath.join('.'), input, method === 'query' ? 'query' : 'mutation')
                }

                // Assume it's a nested router
                return buildProxy(currentPath)[prop]
              },
            }
          )
        },
      }
    )
  }

  return buildProxy()
}
