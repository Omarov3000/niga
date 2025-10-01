import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Query, QueryClient, type QueryOptions, type QueryState } from './query-client'
import { useQueryClient } from './query-client-provider'

export interface InfiniteQueryPageParam<TPageParam = unknown> {
  pageParam: TPageParam
}

export interface InfiniteData<TData = unknown> {
  pages: TData[]
  pageParams: unknown[]
}

export interface UseInfiniteQueryOptions<TData = unknown, TPageParam = unknown> extends Omit<QueryOptions, 'queryFn'> {
  queryFn: (options: { signal: AbortSignal; queryKey: unknown[]; pageParam: TPageParam }) => Promise<TData>
  initialPageParam: TPageParam
  getNextPageParam: (lastPage: TData, allPages: TData[]) => TPageParam | undefined | null
  getPreviousPageParam?: (firstPage: TData, allPages: TData[]) => TPageParam | undefined | null
}

export interface UseInfiniteQueryResult<TData = unknown, TError = Error> {
  data: InfiniteData<TData> | undefined
  error: TError | undefined
  isError: boolean
  isFetching: boolean
  isFetchingNextPage: boolean
  isFetchingPreviousPage: boolean
  isLoading: boolean
  isPending: boolean
  isRefetching: boolean
  isSuccess: boolean
  hasNextPage: boolean
  hasPreviousPage: boolean
  fetchNextPage: () => Promise<void>
  fetchPreviousPage: () => Promise<void>
  refetch: () => Promise<QueryState>
  status: 'pending' | 'error' | 'success'
}

export function useInfiniteQuery<TData = unknown, TPageParam = unknown, TError = Error>(
  options: UseInfiniteQueryOptions<TData, TPageParam>,
  queryClient?: QueryClient
): UseInfiniteQueryResult<TData, TError> {
  const contextClient = useQueryClient(true)
  const client = queryClient ?? contextClient

  if (!client) {
    throw new Error('useInfiniteQuery requires either a queryClient parameter or QueryClientProvider')
  }

  const { queryFn, initialPageParam, getNextPageParam, getPreviousPageParam, enabled = true, ...queryOptions } = options

  const queryRef = useRef<Query | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false)
  const [isFetchingPreviousPage, setIsFetchingPreviousPage] = useState(false)

  // Create wrapped queryFn that handles infinite query logic
  const wrappedQueryFn = async ({ signal, queryKey }: { signal: AbortSignal; queryKey: unknown[] }) => {
    const firstPage = await queryFn({ signal, queryKey, pageParam: initialPageParam })
    return {
      pages: [firstPage],
      pageParams: [initialPageParam],
    } as InfiniteData<TData>
  }

  // Get or create query
  if (!queryRef.current) {
    queryRef.current = client['getOrCreateQuery']({
      ...queryOptions,
      queryFn: wrappedQueryFn,
    })
  }

  const query = queryRef.current

  // Update query options
  useEffect(() => {
    query.options = client['mergeOptions']({
      ...queryOptions,
      queryFn: wrappedQueryFn,
    })
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
        query.fetch()
      }
    }
  }, [enabled, query])

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

  const data = state.data as InfiniteData<TData> | undefined
  const isPending = state.status === 'pending'
  const isSuccess = state.status === 'success'
  const isError = state.status === 'error'
  const isFetching = state.fetchStatus === 'fetching'
  const isLoading = isPending && isFetching
  const isRefetching = isSuccess && isFetching && !isFetchingNextPage && !isFetchingPreviousPage

  const hasNextPage =
    data && data.pages.length > 0
      ? getNextPageParam(data.pages[data.pages.length - 1], data.pages) != null
      : false

  const hasPreviousPage =
    data && data.pages.length > 0 && getPreviousPageParam
      ? getPreviousPageParam(data.pages[0], data.pages) != null
      : false

  const fetchNextPage = async () => {
    if (!hasNextPage || isFetchingNextPage || !data) return

    setIsFetchingNextPage(true)

    try {
      const nextPageParam = getNextPageParam(data.pages[data.pages.length - 1], data.pages)
      if (nextPageParam == null) return

      const abortController = new AbortController()
      const nextPage = await queryFn({
        signal: abortController.signal,
        queryKey: query.queryKey,
        pageParam: nextPageParam,
      })

      // Update query state with new page
      query.state = {
        ...query.state,
        data: {
          pages: [...data.pages, nextPage],
          pageParams: [...data.pageParams, nextPageParam],
        },
      }
      query['notify']()
    } finally {
      setIsFetchingNextPage(false)
    }
  }

  const fetchPreviousPage = async () => {
    if (!hasPreviousPage || isFetchingPreviousPage || !data || !getPreviousPageParam) return

    setIsFetchingPreviousPage(true)

    try {
      const previousPageParam = getPreviousPageParam(data.pages[0], data.pages)
      if (previousPageParam == null) return

      const abortController = new AbortController()
      const previousPage = await queryFn({
        signal: abortController.signal,
        queryKey: query.queryKey,
        pageParam: previousPageParam,
      })

      // Update query state with new page
      query.state = {
        ...query.state,
        data: {
          pages: [previousPage, ...data.pages],
          pageParams: [previousPageParam, ...data.pageParams],
        },
      }
      query['notify']()
    } finally {
      setIsFetchingPreviousPage(false)
    }
  }

  return {
    data,
    error: state.error as TError | undefined,
    isError,
    isFetching,
    isFetchingNextPage,
    isFetchingPreviousPage,
    isLoading,
    isPending,
    isRefetching,
    isSuccess,
    hasNextPage,
    hasPreviousPage,
    fetchNextPage,
    fetchPreviousPage,
    refetch: () => query.fetch(),
    status: state.status,
  }
}
