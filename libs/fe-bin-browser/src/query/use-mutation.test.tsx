import { renderHook } from 'vitest-browser-react'
import { describe, expect, expectTypeOf, it, vi, beforeEach, afterEach } from 'vitest'
import { useMutation } from './use-mutation'
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

it('should handle mutation lifecycle: idle -> pending -> success', async () => {
  let resolveMutation: ((value: string) => void) | undefined
  const mutationFn = vi.fn(
    (variables: { id: number }) =>
      new Promise<string>((resolve) => {
        resolveMutation = resolve
      })
  )

  const onSuccess = vi.fn((data: string, variables: { id: number }) => {})

  const { result } = await renderHook(() =>
    useMutation(
      {
        mutationFn,
        onSuccess,
      },
      queryClient
    )
  )

  // Type checks
  expectTypeOf(result.current.data).toEqualTypeOf<string | undefined>()
  expectTypeOf(result.current.mutate).toEqualTypeOf<(variables: { id: number }) => void>()
  expectTypeOf(result.current.mutateAsync).toEqualTypeOf<(variables: { id: number }) => Promise<string>>()
  expectTypeOf(onSuccess).parameter(0).toEqualTypeOf<string>()
  expectTypeOf(onSuccess).parameter(1).toEqualTypeOf<{ id: number }>()

  // Initial state: idle
  expect(result.current).toMatchObject({
    isIdle: true,
    isPending: false,
    isSuccess: false,
    isError: false,
    data: undefined,
    error: undefined,
    status: 'idle',
  })

  // Trigger mutation
  result.current.mutate({ id: 1 })

  await vi.waitFor(() => {
    expect(result.current.isPending).toBe(true)
  })

  expect(result.current).toMatchObject({
    isIdle: false,
    isPending: true,
    isSuccess: false,
    status: 'pending',
  })

  expect(mutationFn).toHaveBeenCalledWith({ id: 1 })

  // Resolve mutation
  resolveMutation!('success-data')
  await vi.waitFor(() => {
    expect(result.current.isSuccess).toBe(true)
  })

  expect(result.current).toMatchObject({
    data: 'success-data',
    isIdle: false,
    isPending: false,
    isSuccess: true,
    isError: false,
    status: 'success',
    error: undefined,
  })
})

it('should handle mutation errors', async () => {
  const error = new Error('mutation failed')
  const mutationFn = vi.fn(() => Promise.reject(error))

  const { result } = await renderHook(() =>
    useMutation(
      {
        mutationFn,
        retry: false,
      },
      queryClient
    )
  )

  result.current.mutate({})

  await vi.waitFor(() => {
    expect(result.current.isError).toBe(true)
  })

  expect(result.current).toMatchObject({
    error,
    isError: true,
    isSuccess: false,
    isPending: false,
    isIdle: false,
    status: 'error',
    failureCount: 1,
  })
})

it('should call onMutate, onSuccess, and onSettled callbacks', async () => {
  const onMutate = vi.fn()
  const onSuccess = vi.fn()
  const onSettled = vi.fn()
  const mutationFn = vi.fn((variables: { id: number }) => Promise.resolve('data'))

  const { result } = await renderHook(() =>
    useMutation(
      {
        mutationFn,
        onMutate,
        onSuccess,
        onSettled,
      },
      queryClient
    )
  )

  result.current.mutate({ id: 1 })

  await vi.waitFor(() => {
    expect(result.current.isSuccess).toBe(true)
  })

  expect(onMutate).toHaveBeenCalledWith({ id: 1 })
  expect(onSuccess).toHaveBeenCalledWith('data', { id: 1 }, expect.anything())
  expect(onSettled).toHaveBeenCalledWith('data', undefined, { id: 1 }, expect.anything())
})

it('should call onError and onSettled callbacks on error', async () => {
  const error = new Error('mutation failed')
  const onError = vi.fn()
  const onSettled = vi.fn()
  const mutationFn = vi.fn(() => Promise.reject(error))

  const { result } = await renderHook(() =>
    useMutation(
      {
        mutationFn,
        onError,
        onSettled,
        retry: false,
      },
      queryClient
    )
  )

  result.current.mutate({})

  await vi.waitFor(() => {
    expect(result.current.isError).toBe(true)
  })

  expect(onError).toHaveBeenCalledWith(error, {}, expect.anything())
  expect(onSettled).toHaveBeenCalledWith(undefined, error, {}, expect.anything())
})

it('should support mutateAsync and return data', async () => {
  const mutationFn = vi.fn((variables: { id: number }) => Promise.resolve(`data-${variables.id}`))

  const { result } = await renderHook(() =>
    useMutation(
      {
        mutationFn,
      },
      queryClient
    )
  )

  const data = await result.current.mutateAsync({ id: 42 })

  expect(data).toBe('data-42')
  expect(result.current).toMatchObject({
    data: 'data-42',
    isSuccess: true,
  })
})

it('should support mutateAsync and throw on error', async () => {
  const error = new Error('mutation failed')
  const mutationFn = vi.fn(() => Promise.reject(error))

  const { result } = await renderHook(() =>
    useMutation(
      {
        mutationFn,
        retry: false,
      },
      queryClient
    )
  )

  await expect(result.current.mutateAsync({})).rejects.toThrow('mutation failed')

  expect(result.current).toMatchObject({
    error,
    isError: true,
  })
})

it('should reset mutation state', async () => {
  const mutationFn = vi.fn(() => Promise.resolve('data'))

  const { result } = await renderHook(() =>
    useMutation(
      {
        mutationFn,
      },
      queryClient
    )
  )

  await result.current.mutateAsync({})

  expect(result.current.data).toBe('data')
  expect(result.current.isSuccess).toBe(true)

  // Reset mutation
  result.current.reset()

  await vi.waitFor(() => {
    expect(result.current.isIdle).toBe(true)
  })

  expect(result.current).toMatchObject({
    data: undefined,
    error: undefined,
    isIdle: true,
    isPending: false,
    isSuccess: false,
    isError: false,
    status: 'idle',
  })
})

it('should retry on failure when retry is configured', async () => {
  let callCount = 0
  const mutationFn = vi.fn(() => {
    callCount++
    if (callCount < 3) {
      return Promise.reject(new Error('fail'))
    }
    return Promise.resolve('success')
  })

  const { result } = await renderHook(() =>
    useMutation(
      {
        mutationFn,
        retry: 2,
        retryDelay: 100,
      },
      queryClient
    )
  )

  const promise = result.current.mutateAsync({})

  // Wait for retries to complete
  await vi.advanceTimersByTimeAsync(100)
  await vi.advanceTimersByTimeAsync(100)

  await promise

  expect(mutationFn).toHaveBeenCalledTimes(3)
  expect(result.current.data).toBe('success')
  expect(result.current.isSuccess).toBe(true)
})

it('should cleanup mutation after success', async () => {
  const mutationFn = vi.fn(() => Promise.resolve('data'))

  const { result, unmount } = await renderHook(() =>
    useMutation(
      {
        mutationFn,
      },
      queryClient
    )
  )

  result.current.mutate({})

  await vi.waitFor(() => {
    expect(result.current.isSuccess).toBe(true)
  })

  // Wait for cleanup
  await vi.advanceTimersByTimeAsync(10)

  unmount()
})

it('should cleanup mutation on unmount', async () => {
  const mutationFn = vi.fn(() => new Promise(() => {})) // Never resolves

  const { result, unmount } = await renderHook(() =>
    useMutation(
      {
        mutationFn,
      },
      queryClient
    )
  )

  // Verify mutation exists in cache
  const mutationsMap = (queryClient as any).mutations as Map<string, any>
  const mutationCount = mutationsMap.size
  expect(mutationCount).toBeGreaterThan(0)

  unmount()

  // Mutation should be cleaned up
  await vi.advanceTimersByTimeAsync(10)

  // Verify mutation was removed from cache
  expect(mutationsMap.size).toBe(0)
})
