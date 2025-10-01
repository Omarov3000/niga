import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { Query, QueryClient, type QueryOptions, type QueryState } from './query-client'
import { useQueryClient } from './query-client-provider'

export interface UseQueryOptions<TQueryFnData = unknown, TData = TQueryFnData>
  extends Omit<QueryOptions, 'queryFn'> {
  queryFn: (options: { signal: AbortSignal; queryKey: unknown[] }) => Promise<TQueryFnData>
  select?: (data: TQueryFnData) => TData
  enabled?: boolean
}

export interface UseQueryResult<TData = unknown> {
  data: TData | undefined
  error: Error | undefined
  isError: boolean
  isFetching: boolean
  isLoading: boolean
  isPending: boolean
  isRefetching: boolean
  isSuccess: boolean
  refetch: () => Promise<QueryState>
  status: 'pending' | 'error' | 'success'
  promise: Promise<QueryState> | null
}

export function useQuery<TQueryFnData = unknown, TData = TQueryFnData>(
  options: UseQueryOptions<TQueryFnData, TData>,
  queryClient?: QueryClient
): UseQueryResult<TData> {
  const contextClient = useQueryClient(true)
  const client = queryClient ?? contextClient

  if (!client) {
    throw new Error('useQuery requires either a queryClient parameter or QueryClientProvider')
  }

  const { select, ...queryOptions } = options
  const enabled = options.enabled ?? true

  // Get or create query (with enabled in queryOptions)
  const queryRef = useRef<Query | null>(null)
  if (!queryRef.current) {
    queryRef.current = client['getOrCreateQuery']({ ...queryOptions, enabled })
  }
  const query = queryRef.current

  // Update query options
  useEffect(() => {
    query.options = client['mergeOptions'](queryOptions)
  }, [JSON.stringify(queryOptions)])

  // Update enabled state
  useEffect(() => {
    query.setEnabled(enabled)
  }, [enabled])

  // Subscribe to query state changes (memoize subscribe to avoid re-subscribing on every render)
  const subscribe = useCallback((callback: () => void) => query.subscribe(callback), [query])
  const getSnapshot = useCallback(() => query.state, [query])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const data = select && state.data !== undefined ? select(state.data as TQueryFnData) : (state.data as TData | undefined)
  const isPending = state.status === 'pending'
  const isSuccess = state.status === 'success'
  const isError = state.status === 'error'
  const isFetching = state.fetchStatus === 'fetching'
  const isLoading = isPending && isFetching
  const isRefetching = isSuccess && isFetching

  return {
    data,
    error: state.error,
    isError,
    isFetching,
    isLoading,
    isPending,
    isRefetching,
    isSuccess,
    refetch: () => query.fetch(),
    status: state.status,
    promise: state.promise,
  }
}
