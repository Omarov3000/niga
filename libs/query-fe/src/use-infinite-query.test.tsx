import { renderHook } from 'vitest-browser-react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useInfiniteQuery } from './use-infinite-query'
import { QueryClient } from './query-client'

interface Page {
items: number[]
nextCursor?: number
prevCursor?: number
}

const queryClient = new QueryClient()

beforeEach(() => {
  queryClient.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
})

it('should handle pagination flow: initial page, next page, hasNextPage, hasPreviousPage, and isFetchingNextPage states', async () => {
  let resolveNextPage: ((value: Page) => void) | undefined
  let callCount = 0
  const queryFn = vi.fn(
    ({ pageParam }: { pageParam: number }): Promise<Page> => {
      callCount++
      if (callCount === 1) {
        // Initial page resolves immediately
        return Promise.resolve({
          items: [pageParam, pageParam + 1, pageParam + 2],
          nextCursor: pageParam + 3,
        })
      } else if (callCount === 2) {
        // Next page is controlled for testing isFetchingNextPage
        return new Promise<Page>((resolve) => {
          resolveNextPage = resolve
        })
      } else {
        // Final page with no next cursor
        return Promise.resolve({
          items: [pageParam, pageParam + 1, pageParam + 2],
          nextCursor: undefined,
        })
      }
    }
  )

  const { result } = renderHook(() =>
    useInfiniteQuery(
      {
        queryKey: ['test'],
        queryFn,
        initialPageParam: 0,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
      queryClient
    )
  )

  // Initial page fetch
  await vi.waitFor(() => {
    expect(result.current.isSuccess).toBe(true)
  })

  expect(result.current).toMatchObject({
    data: {
      pages: [{ items: [0, 1, 2], nextCursor: 3 }],
      pageParams: [0],
    },
    hasNextPage: true,
    hasPreviousPage: false,
  })

  // Fetch next page and test isFetchingNextPage
  result.current.fetchNextPage()

  await vi.waitFor(() => {
    expect(result.current.isFetchingNextPage).toBe(true)
  })

  resolveNextPage!({
    items: [3, 4, 5],
    nextCursor: 6,
  })

  await vi.waitFor(() => {
    expect(result.current.isFetchingNextPage).toBe(false)
  })

  expect(result.current).toMatchObject({
    data: {
      pages: [
        { items: [0, 1, 2], nextCursor: 3 },
        { items: [3, 4, 5], nextCursor: 6 },
      ],
      pageParams: [0, 3],
    },
    hasNextPage: true,
  })

  // Fetch final page with no next cursor
  await result.current.fetchNextPage()

  expect(result.current).toMatchObject({
    data: {
      pages: [
        { items: [0, 1, 2], nextCursor: 3 },
        { items: [3, 4, 5], nextCursor: 6 },
        { items: [6, 7, 8], nextCursor: undefined },
      ],
      pageParams: [0, 3, 6],
    },
    hasNextPage: false,
  })
})

it('should fetch previous page when getPreviousPageParam is provided', async () => {
  const queryFn = vi.fn(({ pageParam }: { pageParam: number }) =>
    Promise.resolve({
      items: [pageParam, pageParam + 1, pageParam + 2],
      nextCursor: pageParam + 3,
      prevCursor: pageParam > 0 ? pageParam - 3 : undefined,
    })
  )

  const { result } = renderHook(() =>
    useInfiniteQuery(
      {
        queryKey: ['test'],
        queryFn,
        initialPageParam: 3,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        getPreviousPageParam: (firstPage) => firstPage.prevCursor,
      },
      queryClient
    )
  )

  await vi.waitFor(() => {
    expect(result.current.isSuccess).toBe(true)
  })

  expect(result.current.hasPreviousPage).toBe(true)

  await result.current.fetchPreviousPage()

  expect(result.current.data).toMatchObject({
    pages: [
      { items: [0, 1, 2], prevCursor: undefined },
      { items: [3, 4, 5], prevCursor: 0 },
    ],
    pageParams: [0, 3],
  })
  expect(result.current.hasPreviousPage).toBe(false)
})

it('should handle errors', async () => {
  const error = new Error('fetch failed')
  const queryFn = vi.fn(() => Promise.reject(error))

  const { result } = renderHook(() =>
    useInfiniteQuery(
      {
        queryKey: ['test'],
        queryFn,
        initialPageParam: 0,
        getNextPageParam: () => undefined,
        retry: false,
      },
      queryClient
    )
  )

  await vi.waitFor(() => {
    expect(result.current.isError).toBe(true)
  })

  expect(result.current).toMatchObject({
    error,
    isError: true,
    status: 'error',
  })
})

it('should handle refetch flow: reset to initial page, show isRefetching but not isFetchingNextPage', async () => {
  let resolveRefetch: ((value: Page) => void) | undefined
  let callCount = 0
  const queryFn = vi.fn(
    ({ pageParam }: { pageParam: number }): Promise<Page> => {
      callCount++
      if (callCount === 1 || callCount === 2) {
        // Initial fetch and first next page resolve immediately
        return Promise.resolve({
          items: [pageParam, pageParam + 1, pageParam + 2],
          nextCursor: pageParam + 3,
        })
      }
      // Refetch is controlled for testing isRefetching state
      return new Promise<Page>((resolve) => {
        resolveRefetch = resolve
      })
    }
  )

  const { result } = renderHook(() =>
    useInfiniteQuery(
      {
        queryKey: ['test'],
        queryFn,
        initialPageParam: 0,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
      queryClient
    )
  )

  await vi.waitFor(() => {
    expect(result.current.isSuccess).toBe(true)
  })

  await result.current.fetchNextPage()

  expect(queryFn).toHaveBeenCalledTimes(2) // initial + next page

  // Test refetch and isRefetching state
  result.current.refetch()

  await vi.waitFor(() => {
    expect(result.current.isFetching).toBe(true)
    expect(result.current.isFetchingNextPage).toBe(false)
  })

  resolveRefetch!({
    items: [0, 1, 2],
    nextCursor: 3,
  })

  await vi.waitFor(() => {
    expect(result.current.isRefetching).toBe(false)
  })

  expect(queryFn).toHaveBeenCalledTimes(3) // refetch resets to initial page
})
