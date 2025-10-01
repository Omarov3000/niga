import { renderHook } from 'vitest-browser-react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useInfiniteQuery } from './use-infinite-query'
import { QueryClient } from './query-client'

interface Page {
items: number[]
nextCursor?: number
prevCursor?: number
}

let queryClient: QueryClient

beforeEach(() => {
  queryClient = new QueryClient()
  vi.useFakeTimers()
})

afterEach(() => {
  queryClient.clear()
  vi.restoreAllMocks()
})

it('should fetch initial page', async () => {
  const queryFn = vi.fn(({ pageParam }: { pageParam: number }) =>
    Promise.resolve({
      items: [pageParam, pageParam + 1, pageParam + 2],
      nextCursor: pageParam + 3,
    })
  )

  const { result } = await renderHook(() =>
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

  expect(result.current.data).toMatchObject({
    pages: [{ items: [0, 1, 2], nextCursor: 3 }],
    pageParams: [0],
  })
  expect(result.current.hasNextPage).toBe(true)
})

it('should fetch next page', async () => {
  const queryFn = vi.fn(({ pageParam }: { pageParam: number }) =>
    Promise.resolve({
      items: [pageParam, pageParam + 1, pageParam + 2],
      nextCursor: pageParam < 6 ? pageParam + 3 : undefined,
    })
  )

  const { result } = await renderHook(() =>
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

  expect(result.current.hasNextPage).toBe(true)

  await result.current.fetchNextPage()

  expect(result.current.data).toMatchObject({
    pages: [
      { items: [0, 1, 2], nextCursor: 3 },
      { items: [3, 4, 5], nextCursor: 6 },
    ],
    pageParams: [0, 3],
  })
  expect(result.current.hasNextPage).toBe(true)
})

it('should not have next page when getNextPageParam returns null', async () => {
  const queryFn = vi.fn(({ pageParam }: { pageParam: number }) =>
    Promise.resolve({
      items: [pageParam, pageParam + 1, pageParam + 2],
      nextCursor: undefined,
    })
  )

  const { result } = await renderHook(() =>
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

  expect(result.current.hasNextPage).toBe(false)
})

it('should fetch previous page when getPreviousPageParam is provided', async () => {
  const queryFn = vi.fn(({ pageParam }: { pageParam: number }) =>
    Promise.resolve({
      items: [pageParam, pageParam + 1, pageParam + 2],
      nextCursor: pageParam + 3,
      prevCursor: pageParam > 0 ? pageParam - 3 : undefined,
    })
  )

  const { result } = await renderHook(() =>
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

it('should not have previous page when getPreviousPageParam is not provided', async () => {
  const queryFn = vi.fn(({ pageParam }: { pageParam: number }) =>
    Promise.resolve({
      items: [pageParam, pageParam + 1, pageParam + 2],
      nextCursor: pageParam + 3,
    })
  )

  const { result } = await renderHook(() =>
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

  expect(result.current.hasPreviousPage).toBe(false)
})

it('should show isFetchingNextPage while fetching next page', async () => {
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
      }
      // Next page is controlled
      return new Promise<Page>((resolve) => {
        resolveNextPage = resolve
      })
    }
  )

  const { result } = await renderHook(() =>
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
})

it('should handle errors', async () => {
  const error = new Error('fetch failed')
  const queryFn = vi.fn(() => Promise.reject(error))

  const { result } = await renderHook(() =>
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

it('should not fetch when enabled is false', async () => {
  const queryFn = vi.fn(({ pageParam }: { pageParam: number }) =>
    Promise.resolve({
      items: [pageParam],
      nextCursor: pageParam + 1,
    })
  )

  const { result } = await renderHook(() =>
    useInfiniteQuery(
      {
        queryKey: ['test'],
        queryFn,
        initialPageParam: 0,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: false,
      },
      queryClient
    )
  )

  await vi.advanceTimersByTimeAsync(100)

  expect(queryFn).not.toHaveBeenCalled()
  expect(result.current.isPending).toBe(true)
})

it('should refetch all pages when calling refetch', async () => {
  const queryFn = vi.fn(({ pageParam }: { pageParam: number }) =>
    Promise.resolve({
      items: [pageParam, pageParam + 1, pageParam + 2],
      nextCursor: pageParam + 3,
    })
  )

  const { result } = await renderHook(() =>
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

  await result.current.refetch()

  expect(queryFn).toHaveBeenCalledTimes(3) // refetch resets to initial page
})

it('should refetch on window focus when refetchOnWindowFocus is true', async () => {
  const queryFn = vi.fn(({ pageParam }: { pageParam: number }) =>
    Promise.resolve({
      items: [pageParam],
      nextCursor: undefined,
    })
  )

  const { result } = await renderHook(() =>
    useInfiniteQuery(
      {
        queryKey: ['test'],
        queryFn,
        initialPageParam: 0,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        refetchOnWindowFocus: true,
        staleTime: 0,
      },
      queryClient
    )
  )

  await vi.waitFor(() => {
    expect(result.current.isSuccess).toBe(true)
  })

  expect(queryFn).toHaveBeenCalledTimes(1)

  // Simulate window focus
  window.dispatchEvent(new Event('focus'))

  await vi.waitFor(() => {
    expect(queryFn).toHaveBeenCalledTimes(2)
  })
})

it('should refetch at interval when refetchInterval is set', async () => {
  const queryFn = vi.fn(({ pageParam }: { pageParam: number }) =>
    Promise.resolve({
      items: [pageParam],
      nextCursor: undefined,
    })
  )

  const { result } = await renderHook(() =>
    useInfiniteQuery(
      {
        queryKey: ['test'],
        queryFn,
        initialPageParam: 0,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        refetchInterval: 1000,
      },
      queryClient
    )
  )

  await vi.waitFor(() => {
    expect(result.current.isSuccess).toBe(true)
  })

  expect(queryFn).toHaveBeenCalledTimes(1)

  await vi.advanceTimersByTimeAsync(1000)

  await vi.waitFor(() => {
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  await vi.advanceTimersByTimeAsync(1000)

  await vi.waitFor(() => {
    expect(queryFn).toHaveBeenCalledTimes(3)
  })
})

it('should show isRefetching when refetching but not isFetchingNextPage', async () => {
  let resolveQuery: ((value: Page) => void) | undefined
  let callCount = 0
  const queryFn = vi.fn(
    ({ pageParam }: { pageParam: number }): Promise<Page> => {
      callCount++
      if (callCount === 1) {
        // Initial fetch resolves immediately
        return Promise.resolve({
          items: [pageParam],
          nextCursor: undefined,
        })
      }
      // Refetch is controlled
      return new Promise<Page>((resolve) => {
        resolveQuery = resolve
      })
    }
  )

  const { result } = await renderHook(() =>
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

  result.current.refetch()

  await vi.waitFor(() => {
    expect(result.current.isFetching).toBe(true)
    expect(result.current.isFetchingNextPage).toBe(false)
  })

  resolveQuery!({
    items: [0],
    nextCursor: undefined,
  })

  await vi.waitFor(() => {
    expect(result.current.isRefetching).toBe(false)
  })
})
