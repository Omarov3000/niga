import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Query, QueryClient, type QueryOptions, type QueryState } from './query-client'
import { useQueryClient } from './query-client-provider'

export interface UseQueryOptions<TData = unknown, TError = Error> extends QueryOptions {
  select?: (data: unknown) => TData
  enabled?: boolean
}

export interface UseQueryResult<TData = unknown, TError = Error> {
  data: TData | undefined
  error: TError | undefined
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

export function useQuery<TData = unknown, TError = Error>(
  options: UseQueryOptions<TData, TError>,
  queryClient?: QueryClient
): UseQueryResult<TData, TError> {
  const contextClient = useQueryClient(true)
  const client = queryClient ?? contextClient

  if (!client) {
    throw new Error('useQuery requires either a queryClient parameter or QueryClientProvider')
  }

  const { select, enabled = true, ...queryOptions } = options

  const queryRef = useRef<Query | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const promiseRef = useRef<Promise<QueryState> | null>(null)

  // Get or create query
  if (!queryRef.current) {
    queryRef.current = client['getOrCreateQuery'](queryOptions)
  }

  const query = queryRef.current

  // Update query options
  useEffect(() => {
    query.options = client['mergeOptions'](queryOptions)
  }, [JSON.stringify(queryOptions)])

  // Subscribe to query state changes
  const state = useSyncExternalStore(
    (callback) => {
      unsubscribeRef.current?.()
      unsubscribeRef.current = query.subscribe(callback)
      return () => {
        unsubscribeRef.current?.()
        unsubscribeRef.current = null
      }
    },
    () => query.state,
    () => query.state
  )

  // Fetch on mount and when enabled changes
  useEffect(() => {
    if (enabled) {
      const staleTime = query.options.staleTime ?? 0
      if (query.state.status !== 'success' || query.isStale(staleTime)) {
        promiseRef.current = query.fetch()
      }
    }
  }, [enabled, query])

  // Update promise ref when query state changes
  if (state.status === 'pending' && enabled) {
    if (!promiseRef.current) {
      const staleTime = query.options.staleTime ?? 0
      if (query.state.status !== 'success' || query.isStale(staleTime)) {
        promiseRef.current = query.fetch()
      }
    }
  } else if (state.status !== 'pending') {
    promiseRef.current = null
  }

  // Handle refetchOnWindowFocus
  useEffect(() => {
    if (enabled && query.options.refetchOnWindowFocus) {
      const handleFocus = () => {
        const staleTime = query.options.staleTime ?? 0
        if (query.isStale(staleTime)) {
          query.fetch()
        }
      }

      window.addEventListener('focus', handleFocus)
      return () => window.removeEventListener('focus', handleFocus)
    }
  }, [enabled, query.options.refetchOnWindowFocus, query])

  // Handle refetchInterval
  useEffect(() => {
    if (enabled && query.options.refetchInterval) {
      const interval = setInterval(() => {
        query.fetch()
      }, query.options.refetchInterval)

      return () => clearInterval(interval)
    }
  }, [enabled, query.options.refetchInterval, query])

  const data = select && state.data !== undefined ? select(state.data) : (state.data as TData | undefined)
  const isPending = state.status === 'pending'
  const isSuccess = state.status === 'success'
  const isError = state.status === 'error'
  const isFetching = state.fetchStatus === 'fetching'
  const isLoading = isPending && isFetching
  const isRefetching = isSuccess && isFetching

  return {
    data,
    error: state.error as TError | undefined,
    isError,
    isFetching,
    isLoading,
    isPending,
    isRefetching,
    isSuccess,
    refetch: () => query.fetch(),
    status: state.status,
    promise: promiseRef.current,
  }
}
