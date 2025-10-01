import type { QueryClient, QueryOptions, QueryState } from './query-client'
import { useQuery, type UseQueryOptions } from './use-query'

export interface UseSuspenseQueryOptions<TData = unknown> extends Omit<QueryOptions, 'throwOnError' | 'enabled'> {
  select?: (data: unknown) => TData
}

export interface UseSuspenseQueryResult<TData = unknown, TError = Error> {
  data: TData
  error: TError | undefined
  isError: boolean
  isFetching: boolean
  isRefetching: boolean
  isSuccess: boolean
  refetch: () => Promise<QueryState>
  status: 'success' | 'error'
}

export function useSuspenseQuery<TData = unknown, TError = Error>(
  options: UseSuspenseQueryOptions<TData>,
  queryClient?: QueryClient
): UseSuspenseQueryResult<TData, TError> {
  const result = useQuery<TData, TError>(
    {
      ...options,
      throwOnError: true,
      enabled: true,
    } as UseQueryOptions<TData, TError>,
    queryClient
  )

  // Suspend if query is pending
  if (result.status === 'pending') {
    if (result.promise) {
      throw result.promise
    }
  }

  // Throw error if query failed
  if (result.status === 'error') {
    if (result.error) {
      throw result.error
    }
  }

  // At this point, status must be 'success' and data is guaranteed to be defined
  return {
    data: result.data as TData,
    error: result.error,
    isError: false,
    isFetching: result.isFetching,
    isRefetching: result.isRefetching,
    isSuccess: true,
    refetch: result.refetch,
    status: 'success' as const,
  }
}
