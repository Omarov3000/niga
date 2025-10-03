import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
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

export interface UseInfiniteQueryResult<TData = unknown> {
  data: InfiniteData<TData> | undefined
  error: Error | undefined
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

export function useInfiniteQuery<TData = unknown, TPageParam = unknown>(
  options: UseInfiniteQueryOptions<TData, TPageParam>,
  queryClient?: QueryClient
): UseInfiniteQueryResult<TData> {
  const contextClient = useQueryClient(true)
  const client = queryClient ?? contextClient

  if (!client) {
    throw new Error('useInfiniteQuery requires either a queryClient parameter or QueryClientProvider')
  }

  const { queryFn, initialPageParam, getNextPageParam, getPreviousPageParam, ...queryOptions } = options

  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false)
  const [isFetchingPreviousPage, setIsFetchingPreviousPage] = useState(false)

  // Create wrapped queryFn that handles infinite query logic (memoize to avoid recreating)
  const wrappedQueryFn = useMemo(
    () => async ({ signal, queryKey }: { signal: AbortSignal; queryKey: unknown[] }) => {
      const firstPage = await queryFn({ signal, queryKey, pageParam: initialPageParam })
      return {
        pages: [firstPage],
        pageParams: [initialPageParam],
      } as InfiniteData<TData>
    },
    [queryFn, initialPageParam]
  )

  // Sync query options and get query (runs on every render)
  const query = client.syncQueryOptions({
    ...queryOptions,
    queryFn: wrappedQueryFn,
  })

  // Subscribe to query state changes (memoize subscribe to avoid re-subscribing on every render)
  const subscribe = useCallback((callback: () => void) => query.subscribe(callback), [query.queryHash])
  const getSnapshot = useCallback(() => query.state, [query.queryHash])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

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
    error: state.error,
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
