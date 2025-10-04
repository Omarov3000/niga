import type { AnyRouter, AnyProcedure } from '../core/types'

type CreateOptionsProxy<TRouter extends AnyRouter> = {
  [K in keyof TRouter]: TRouter[K] extends AnyProcedure
    ? {
        queryOptions: TRouter[K]['_types']['queryOptions']
        mutationOptions: TRouter[K]['_types']['mutationOptions']
      }
    : TRouter[K] extends AnyRouter
    ? CreateOptionsProxy<TRouter[K]>
    : never
}

export interface RpcOptionsConfig {
  client: {
    query: (path: string, input: any) => Promise<any>
    mutate: (path: string, input: any) => Promise<any>
  }
  queryClient: any
}

export function createRpcOptionsProxy<TRouter extends AnyRouter>(
  config: RpcOptionsConfig
): CreateOptionsProxy<TRouter> {
  const buildProxy = (basePath: string[] = []): any => {
    return new Proxy(
      {},
      {
        get(_target, prop: string) {
          const currentPath = [...basePath, prop]
          const pathString = currentPath.join('.')

          return new Proxy(
            {},
            {
              get(_innerTarget, method: string) {
                if (method === 'queryOptions') {
                  return (input?: any) => {
                    return {
                      queryKey: [...currentPath, input],
                      queryFn: async ({ signal }: { signal: AbortSignal }) => {
                        return config.client.query(pathString, input)
                      },
                    }
                  }
                }

                if (method === 'mutationOptions') {
                  return () => {
                    return {
                      mutationFn: async (variables: any) => {
                        return config.client.mutate(pathString, variables)
                      },
                    }
                  }
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
