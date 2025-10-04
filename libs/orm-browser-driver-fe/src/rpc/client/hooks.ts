import type { AnyRouter, AnyProcedure, Procedure } from '../core/types'
import type { UseQueryOptions } from '@w/query-fe'
import type { UseMutationOptions } from '@w/query-fe'

type InferProcedureInput<T> = T extends Procedure<infer TInput, any, any, any> ? TInput : never
type InferProcedureOutput<T> = T extends Procedure<any, infer TOutput, any, any> ? TOutput : never

type CreateOptionsProxy<TRouter extends AnyRouter> = {
  [K in keyof TRouter]: TRouter[K] extends AnyProcedure
    ? {
        queryOptions: (
          input?: InferProcedureInput<TRouter[K]>
        ) => UseQueryOptions<InferProcedureOutput<TRouter[K]>, InferProcedureOutput<TRouter[K]>>
        mutationOptions: () => UseMutationOptions<
          InferProcedureOutput<TRouter[K]>,
          InferProcedureInput<TRouter[K]>
        >
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
