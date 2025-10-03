import { renderHook } from 'vitest-browser-react'
import { describe, expect, expectTypeOf, it, vi, beforeEach, afterEach } from 'vitest'
import { useQuery } from './use-query'
import { QueryClient } from './query-client'

const queryClient = new QueryClient()

beforeEach(() => {
  queryClient.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
})

it('should handle complete query lifecycle: fetch, refetch, and show loading states', async () => {
  let resolveQuery: ((value: string) => void) | undefined
  const queryFn = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        resolveQuery = resolve
      })
  )

  const { result } = renderHook(() =>
    useQuery(
      {
        queryKey: ['test'],
        queryFn,
      },
      queryClient
    )
  )

  expectTypeOf(result.current.data).toEqualTypeOf<string | undefined>()

  // Initial state: pending and loading
  expect(result.current).toMatchObject({
    isPending: true,
    isLoading: true,
    isFetching: true,
    isSuccess: false,
    data: undefined,
  })

  // Resolve initial fetch
  resolveQuery!('data')
  await vi.waitFor(() => {
    expect(result.current.isSuccess).toBe(true)
  })

  expect(result.current).toMatchObject({
    data: 'data',
    isSuccess: true,
    isPending: false,
    isLoading: false,
    isFetching: false,
    error: undefined,
  })

  expect(queryFn).toHaveBeenCalledTimes(1)

  // Test refetch and isRefetching state
  result.current.refetch()

  await vi.waitFor(() => {
    expect(result.current.isRefetching).toBe(true)
    expect(result.current.isFetching).toBe(true)
    expect(result.current.isLoading).toBe(false) // Not loading, just refetching
  })

  expect(queryFn).toHaveBeenCalledTimes(2)

  // Resolve refetch
  resolveQuery!('refetched-data')

  await vi.waitFor(() => {
    expect(result.current.isRefetching).toBe(false)
    expect(result.current.data).toBe('refetched-data')
  })
})

it('should use initialData without fetching when not stale', async () => {
  const queryFn = vi.fn(() => Promise.resolve('fresh-data'))

  const { result } = renderHook(() =>
    useQuery(
      {
        queryKey: ['test'],
        queryFn,
        initialData: 'initial-data',
      },
      queryClient
    )
  )

  // Should show initialData immediately
  expect(result.current).toMatchObject({
    data: 'initial-data',
    isSuccess: true,
    isPending: false,
  })

  // Should not fetch since initialData is not stale
  await vi.advanceTimersByTimeAsync(100)
  expect(queryFn).not.toHaveBeenCalled()
})

it('should handle errors', async () => {
  const error = new Error('fetch failed')
  const queryFn = vi.fn(() => Promise.reject(error))

  const { result } = renderHook(() =>
    useQuery(
      {
        queryKey: ['test'],
        queryFn,
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
    isSuccess: false,
    status: 'error',
  })
})

it('should use select to transform data', async () => {
  const queryFn = vi.fn(() => Promise.resolve({ value: 42 }))

  const { result } = renderHook(() =>
    useQuery(
      {
        queryKey: ['test'],
        queryFn,
        select: (data) => data.value * 2,
      },
      queryClient
    )
  )

  expectTypeOf(result.current.data).toEqualTypeOf<number | undefined>()

  await vi.waitFor(() => {
    expect(result.current.isSuccess).toBe(true)
  })

  expect(result.current.data).toBe(84)
})

it('should not fetch when enabled is false', async () => {
  const queryFn = vi.fn(() => Promise.resolve('data'))

  const { result } = renderHook(() =>
    useQuery(
      {
        queryKey: ['test'],
        queryFn,
        enabled: false,
      },
      queryClient
    )
  )

  await vi.advanceTimersByTimeAsync(100)

  expect(queryFn).not.toHaveBeenCalled()
  expect(result.current.isPending).toBe(true)
})

it('should refetch when invalidateQueries is called', async () => {
  const queryFn = vi.fn(() => Promise.resolve('data'))

  const { result } = renderHook(() =>
    useQuery(
      {
        queryKey: ['test'],
        queryFn,
      },
      queryClient
    )
  )

  await vi.waitFor(() => {
    expect(result.current.isSuccess).toBe(true)
  })

  expect(queryFn).toHaveBeenCalledTimes(1)

  // Invalidate queries
  await queryClient.invalidateQueries({ queryKey: ['test'] })

  await vi.waitFor(() => {
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  expect(result.current.isSuccess).toBe(true)
  expect(result.current.data).toBe('data')
})

it('should respect staleTime', async () => {
  const queryFn = vi.fn(() => Promise.resolve('data'))

  const { result, unmount } = renderHook(() =>
    useQuery(
      {
        queryKey: ['test'],
        queryFn,
        staleTime: 5000,
      },
      queryClient
    )
  )

  await vi.waitFor(() => {
    expect(result.current.isSuccess).toBe(true)
  })

  expect(queryFn).toHaveBeenCalledTimes(1)

  unmount()

  // Remount before staleTime expires
  await vi.advanceTimersByTimeAsync(3000)
  const { result: result2 } = renderHook(() =>
    useQuery(
      {
        queryKey: ['test'],
        queryFn,
        staleTime: 5000,
      },
      queryClient
    )
  )

  expect(queryFn).toHaveBeenCalledTimes(1) // Should not refetch
  expect(result2.current.data).toBe('data')
})

it('should refetch on window focus when refetchOnWindowFocus is true', async () => {
  const queryFn = vi.fn(() => Promise.resolve('data'))

  const { result } = renderHook(() =>
    useQuery(
      {
        queryKey: ['test'],
        queryFn,
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

it('should not refetch on window focus when refetchOnWindowFocus is false', async () => {
  const queryFn = vi.fn(() => Promise.resolve('data'))

  const { result } = renderHook(() =>
    useQuery(
      {
        queryKey: ['test'],
        queryFn,
        refetchOnWindowFocus: false,
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

  await vi.advanceTimersByTimeAsync(100)

  expect(queryFn).toHaveBeenCalledTimes(1)
})

it('should refetch at interval when refetchInterval is set', async () => {
  const queryFn = vi.fn(() => Promise.resolve('data'))

  const { result } = renderHook(() =>
    useQuery(
      {
        queryKey: ['test'],
        queryFn,
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

it('should create new query instance when queryKey changes to prevent race conditions', async () => {
  let resolveUser1: ((value: { id: number; name: string }) => void) | undefined
  let resolveUser2: ((value: { id: number; name: string }) => void) | undefined

  const queryFn = vi.fn((options: { queryKey: unknown[] }) => {
    const userId = options.queryKey[1] as number
    return new Promise<{ id: number; name: string }>((resolve) => {
      if (userId === 1) {
        resolveUser1 = resolve
      } else {
        resolveUser2 = resolve
      }
    })
  })

  const { result, rerender } = renderHook(
    (props?: { userId: number }) =>
      useQuery(
        {
          queryKey: ['user', props?.userId ?? 1],
          queryFn,
          staleTime: 0, // Ensure refetch happens
        },
        queryClient
      ),
    {
      initialProps: { userId: 1 },
    }
  )

  // Wait for initial fetch to start
  await vi.waitFor(() => {
    expect(result.current.isFetching).toBe(true)
  })
  expect(queryFn).toHaveBeenCalledTimes(1)

  // Change queryKey while first fetch is in progress
  rerender({ userId: 2 })

  // Manually trigger a microtask to ensure rerender is processed
  await vi.advanceTimersByTimeAsync(0)

  // Second fetch may or may not start immediately due to the race condition bug
  // Let's check if it was called at all
  const secondFetchStarted = queryFn.mock.calls.length === 2

  if (secondFetchStarted) {
    // Fixed: new Query instance created, so second fetch started
    // Resolve second fetch first (the newer one)
    resolveUser2!({ id: 2, name: 'User 2' })

    await vi.waitFor(() => {
      expect(result.current.data).toEqual({ id: 2, name: 'User 2' })
    })

    // Resolve first fetch later (the older one)
    resolveUser1!({ id: 1, name: 'User 1' })

    // Wait a bit to ensure the old response doesn't override
    await vi.advanceTimersByTimeAsync(100)

    // Data should still be User 2 (the newer request), not User 1
    expect(result.current.data).toEqual({ id: 2, name: 'User 2' })
  } else {
    // Bug: queryKey changed but same Query instance is used
    expect(queryFn).toHaveBeenCalledTimes(1) // Only called once with old queryKey

    // Resolve the single fetch
    resolveUser1!({ id: 1, name: 'User 1' })

    await vi.waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    // Bug: showing data for wrong queryKey
    expect(result.current.data).toEqual({ id: 1, name: 'User 1' })
    // But we're asking for user 2!
    throw new Error('Bug detected: queryKey changed but same Query instance is being reused')
  }
})
