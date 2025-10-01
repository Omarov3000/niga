import type { QueryClient, QueryOptions, QueryState } from './query-client'
import { useQuery, type UseQueryOptions } from './use-query'

export interface UseSuspenseQueryOptions<TQueryFnData = unknown, TData = TQueryFnData>
  extends Omit<QueryOptions, 'throwOnError' | 'enabled' | 'queryFn'> {
  queryFn: (options: { signal: AbortSignal; queryKey: unknown[] }) => Promise<TQueryFnData>
  select?: (data: TQueryFnData) => TData
}

export interface UseSuspenseQueryResult<TData> {
  data: TData
  error: Error | undefined
  isError: boolean
  isFetching: boolean
  isRefetching: boolean
  isSuccess: boolean
  refetch: () => Promise<QueryState>
  status: 'success' | 'error'
}

export function useSuspenseQuery<TQueryFnData = unknown, TData = TQueryFnData>(
  options: UseSuspenseQueryOptions<TQueryFnData, TData>,
  queryClient?: QueryClient
): UseSuspenseQueryResult<TData> {
  const result = useQuery<TQueryFnData, TData>(
    {
      ...options,
      throwOnError: true,
      enabled: true,
    },
    queryClient
  )

  // Suspend if query is pending
  if (result.status === 'pending') {
    if (!result.promise) {
      // If no promise exists yet, create one by calling refetch
      throw result.refetch()
    }
    throw result.promise
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
