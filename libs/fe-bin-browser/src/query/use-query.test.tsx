import { renderHook } from 'vitest-browser-react'
import { describe, expect, expectTypeOf, it, vi, beforeEach, afterEach } from 'vitest'
import { useQuery } from './use-query'
import { QueryClient } from './query-client'

let queryClient: QueryClient

beforeEach(() => {
  queryClient = new QueryClient()
  vi.useFakeTimers()
})

afterEach(() => {
  queryClient.destroy()
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

  const { result } = await renderHook(() =>
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

  const { result } = await renderHook(() =>
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

  const { result } = await renderHook(() =>
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

  const { result } = await renderHook(() =>
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

  const { result } = await renderHook(() =>
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

  const { result } = await renderHook(() =>
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

  const { result, unmount } = await renderHook(() =>
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
  const { result: result2 } = await renderHook(() =>
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

  const { result } = await renderHook(() =>
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

  const { result } = await renderHook(() =>
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

  const { result } = await renderHook(() =>
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
