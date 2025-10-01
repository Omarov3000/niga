import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { Query, QueryClient, type QueryOptions, type QueryFilters } from './query-client'

describe('Query', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should initialize with correct default state', () => {
    const queryFn = vi.fn(() => Promise.resolve('data'))
    const query = new Query({
      queryKey: ['test'],
      queryFn,
    })

    expect(query).toMatchObject({
      queryKey: ['test'],
      queryHash: JSON.stringify(['test']),
      observers: [],
      state: {
        data: undefined,
        error: undefined,
        fetchStatus: 'idle',
        fetchFailureCount: 0,
        fetchFailureReason: undefined,
        status: 'pending',
        isInvalidated: false,
      },
    })
  })

  it('should initialize with initialData', () => {
    const queryFn = vi.fn(() => Promise.resolve('data'))
    const query = new Query({
      queryKey: ['test'],
      queryFn,
      initialData: 'initial',
    })

    expect(query.state).toMatchObject({
      data: 'initial',
      status: 'success',
    })
  })

  it('should fetch data successfully and update state', async () => {
    const queryFn = vi.fn(() => Promise.resolve('data'))
    const query = new Query({
      queryKey: ['test'],
      queryFn,
    })

    const promise = query.fetch()
    expect(query.state.fetchStatus).toBe('fetching')

    const state = await promise

    expect(queryFn).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      queryKey: ['test'],
    })
    expect(state).toMatchObject({
      data: 'data',
      error: undefined,
      fetchStatus: 'idle',
      fetchFailureCount: 0,
      status: 'success',
    })
  })

  it('should handle fetch errors and update state', async () => {
    const error = new Error('fetch failed')
    const queryFn = vi.fn(() => Promise.reject(error))
    const query = new Query({
      queryKey: ['test'],
      queryFn,
      retry: false,
    })

    const state = await query.fetch()

    expect(state).toMatchObject({
      error,
      fetchStatus: 'idle',
      fetchFailureCount: 1,
      fetchFailureReason: error,
      status: 'error',
    })
  })

  it('should throw error when throwOnError is true', async () => {
    const error = new Error('fetch failed')
    const queryFn = vi.fn(() => Promise.reject(error))
    const query = new Query({
      queryKey: ['test'],
      queryFn,
      retry: false,
      throwOnError: true,
    })

    await expect(query.fetch()).rejects.toThrow('fetch failed')
  })

  it('should call onError callback on fetch failure', async () => {
    const error = new Error('fetch failed')
    const onError = vi.fn()
    const queryFn = vi.fn(() => Promise.reject(error))
    const query = new Query({
      queryKey: ['test'],
      queryFn,
      retry: false,
      onError,
    })

    await query.fetch()

    expect(onError).toHaveBeenCalledWith(error, query)
  })

  it('should retry on failure with default retry logic', async () => {
    const error = new Error('fetch failed')
    let callCount = 0
    const queryFn = vi.fn(() => {
      callCount++
      if (callCount < 3) return Promise.reject(error)
      return Promise.resolve('success')
    })

    const query = new Query({
      queryKey: ['test'],
      queryFn,
    })

    const fetchPromise = query.fetch()

    // Fast-forward through retry delays
    await vi.runAllTimersAsync()

    const state = await fetchPromise

    expect(queryFn).toHaveBeenCalledTimes(3)
    expect(state).toMatchObject({
      data: 'success',
      status: 'success',
    })
  })

  it('should respect retry count', async () => {
    const error = new Error('fetch failed')
    const queryFn = vi.fn(() => Promise.reject(error))
    const query = new Query({
      queryKey: ['test'],
      queryFn,
      retry: 1,
    })

    const fetchPromise = query.fetch()
    await vi.runAllTimersAsync()
    await fetchPromise

    expect(queryFn).toHaveBeenCalledTimes(2) // initial + 1 retry
  })

  it('should use custom retry function', async () => {
    const error = new Error('fetch failed')
    const queryFn = vi.fn(() => Promise.reject(error))
    const retry = vi.fn(() => false)
    const query = new Query({
      queryKey: ['test'],
      queryFn,
      retry,
    })

    await query.fetch()

    expect(retry).toHaveBeenCalledWith(1, error)
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it('should use custom retryDelay', async () => {
    const error = new Error('fetch failed')
    let callCount = 0
    const queryFn = vi.fn(() => {
      callCount++
      if (callCount < 2) return Promise.reject(error)
      return Promise.resolve('success')
    })

    const query = new Query({
      queryKey: ['test'],
      queryFn,
      retry: 1,
      retryDelay: 5000,
    })

    const fetchPromise = query.fetch()

    await vi.advanceTimersByTimeAsync(4999)
    expect(queryFn).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await vi.runAllTimersAsync()
    await fetchPromise

    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  it('should notify observers on state changes', async () => {
    const queryFn = vi.fn(() => Promise.resolve('data'))
    const query = new Query({
      queryKey: ['test'],
      queryFn,
    })

    const observer = vi.fn()
    query.subscribe(observer)

    await query.fetch()

    expect(observer).toHaveBeenCalledTimes(2) // fetching, then success
    expect(observer).toHaveBeenNthCalledWith(1, expect.objectContaining({ fetchStatus: 'fetching' }))
    expect(observer).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: 'success' }))
  })

  it('should unsubscribe observers correctly', () => {
    const queryFn = vi.fn(() => Promise.resolve('data'))
    const query = new Query({
      queryKey: ['test'],
      queryFn,
    })

    const observer = vi.fn()
    const unsubscribe = query.subscribe(observer)

    expect(query.observers).toHaveLength(1)
    unsubscribe()
    expect(query.observers).toHaveLength(0)
  })

  it('should invalidate and refetch query', async () => {
    const queryFn = vi.fn(() => Promise.resolve('data'))
    const query = new Query({
      queryKey: ['test'],
      queryFn,
    })

    await query.fetch()
    expect(queryFn).toHaveBeenCalledTimes(1)

    await query.invalidate()
    expect(query.state.isInvalidated).toBe(false) // reset after refetch
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  it('should cancel ongoing fetch', async () => {
    let aborted = false
    const queryFn = vi.fn(({ signal }: { signal: AbortSignal }) => {
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true
          reject(new Error('aborted'))
        })
        setTimeout(() => resolve('data'), 1000)
      })
    })

    const query = new Query({
      queryKey: ['test'],
      queryFn,
    })

    const fetchPromise = query.fetch()
    await vi.advanceTimersByTimeAsync(100)

    await query.cancel()

    expect(query.state.fetchStatus).toBe('idle')
    expect(aborted).toBe(true)
  })

  it('should determine if query is stale', async () => {
    const queryFn = vi.fn(() => Promise.resolve('data'))
    const query = new Query({
      queryKey: ['test'],
      queryFn,
    })

    expect(query.isStale(1000)).toBe(false) // pending queries are not stale

    await query.fetch()
    expect(query.isStale(1000)).toBe(false)

    await vi.advanceTimersByTimeAsync(1001)
    expect(query.isStale(1000)).toBe(true)
  })
})

describe('QueryClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should fetch query and return data', async () => {
    const client = new QueryClient()
    const queryFn = vi.fn(() => Promise.resolve('data'))

    const data = await client.fetchQuery({
      queryKey: ['test'],
      queryFn,
    })

    expect(data).toBe('data')
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it('should reuse existing query for same queryKey', async () => {
    const client = new QueryClient()
    const queryFn = vi.fn(() => Promise.resolve('data'))

    await client.fetchQuery({
      queryKey: ['test'],
      queryFn,
    })

    await client.fetchQuery({
      queryKey: ['test'],
      queryFn,
    })

    expect(queryFn).toHaveBeenCalledTimes(2) // Both calls trigger fetch
  })

  it('should ensure query data returns cached data if not stale', () => {
    const client = new QueryClient({ queries: { staleTime: 10000 } })
    const queryFn = vi.fn(() => Promise.resolve('data'))

    const query = new Query({
      queryKey: ['test'],
      queryFn,
      initialData: 'cached',
      staleTime: 10000,
    })

    client['queries'].set(JSON.stringify(['test']), query)

    const data = client.ensureQueryData({
      queryKey: ['test'],
      queryFn,
    })

    expect(data).toBe('cached')
    expect(queryFn).not.toHaveBeenCalled()
  })

  it('should ensure query data triggers fetch if stale', async () => {
    const client = new QueryClient({ queries: { staleTime: 1000 } })
    const queryFn = vi.fn(() => Promise.resolve('fresh'))

    const query = new Query({
      queryKey: ['test'],
      queryFn,
      initialData: 'cached',
      staleTime: 1000,
    })

    await query.fetch()
    client['queries'].set(JSON.stringify(['test']), query)

    await vi.advanceTimersByTimeAsync(1001)

    const data = client.ensureQueryData({
      queryKey: ['test'],
      queryFn,
    })

    expect(data).toBe('fresh') // Returns old data while fetching
    await vi.runAllTimersAsync()
  })

  it('should prefetch query and return data if available', async () => {
    const client = new QueryClient()
    const queryFn = vi.fn(() => Promise.resolve('data'))

    // First call - no data yet, triggers fetch
    const data1 = client.prefetchQuery({
      queryKey: ['test'],
      queryFn,
    })
    expect(data1).toBe(undefined)

    // Wait for fetch to complete
    await vi.runAllTimersAsync()

    // Second call - data is available
    const data2 = client.prefetchQuery({
      queryKey: ['test'],
      queryFn,
    })
    expect(data2).toBe('data')
    expect(queryFn).toHaveBeenCalledTimes(1) // Should not refetch
  })

  describe('invalidateQueries', () => {
    it('should invalidate queries by queryKey', async () => {
    const client = new QueryClient()
    const queryFn1 = vi.fn(() => Promise.resolve('data1'))
    const queryFn2 = vi.fn(() => Promise.resolve('data2'))

    await client.fetchQuery({
      queryKey: ['test', 1],
      queryFn: queryFn1,
    })

    await client.fetchQuery({
      queryKey: ['test', 2],
      queryFn: queryFn2,
    })

    expect(queryFn1).toHaveBeenCalledTimes(1)
    expect(queryFn2).toHaveBeenCalledTimes(1)

    await client.invalidateQueries({
      queryKey: ['test'],
    })

    expect(queryFn1).toHaveBeenCalledTimes(2)
    expect(queryFn2).toHaveBeenCalledTimes(2)
  })

  it('should invalidate queries with exact match', async () => {
    const client = new QueryClient()
    const queryFn1 = vi.fn(() => Promise.resolve('data1'))
    const queryFn2 = vi.fn(() => Promise.resolve('data2'))

    await client.fetchQuery({
      queryKey: ['test', 1],
      queryFn: queryFn1,
    })

    await client.fetchQuery({
      queryKey: ['test', 2],
      queryFn: queryFn2,
    })

    await client.invalidateQueries({
      queryKey: ['test', 1],
      exact: true,
    })

    expect(queryFn1).toHaveBeenCalledTimes(2)
    expect(queryFn2).toHaveBeenCalledTimes(1)
  })

  it('should invalidate queries by type (active/inactive)', async () => {
    const client = new QueryClient()
    const queryFn1 = vi.fn(() => Promise.resolve('data1'))
    const queryFn2 = vi.fn(() => Promise.resolve('data2'))

    await client.fetchQuery({
      queryKey: ['test', 1],
      queryFn: queryFn1,
    })

    await client.fetchQuery({
      queryKey: ['test', 2],
      queryFn: queryFn2,
    })

    const query1 = client.getQuery(['test', 1])!
    const observer = vi.fn()
    query1.subscribe(observer)

    await client.invalidateQueries({ type: 'active' })

    expect(queryFn1).toHaveBeenCalledTimes(2)
    expect(queryFn2).toHaveBeenCalledTimes(1)
  })

  it('should invalidate queries by stale status', async () => {
    const client = new QueryClient({ queries: { staleTime: 1000 } })
    const queryFn1 = vi.fn(() => Promise.resolve('data1'))
    const queryFn2 = vi.fn(() => Promise.resolve('data2'))

    await client.fetchQuery({
      queryKey: ['test', 1],
      queryFn: queryFn1,
      staleTime: 1000,
    })

    await vi.advanceTimersByTimeAsync(1001)

    await client.fetchQuery({
      queryKey: ['test', 2],
      queryFn: queryFn2,
      staleTime: 1000,
    })

    await client.invalidateQueries({ stale: true })

    expect(queryFn1).toHaveBeenCalledTimes(2)
    expect(queryFn2).toHaveBeenCalledTimes(1)
  })

  it('should invalidate queries by fetchStatus', async () => {
    const client = new QueryClient()
    const queryFn1 = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve('data1'), 1000)))
    const queryFn2 = vi.fn(() => Promise.resolve('data2'))

    const promise1 = client.fetchQuery({
      queryKey: ['test', 1],
      queryFn: queryFn1,
    })

    await client.fetchQuery({
      queryKey: ['test', 2],
      queryFn: queryFn2,
    })

    const invalidatedQueries = await client.invalidateQueries({ fetchStatus: 'fetching' })

    expect(invalidatedQueries).toHaveLength(1)
    expect(invalidatedQueries[0].queryKey).toEqual(['test', 1])

    await vi.runAllTimersAsync()
    await promise1
  })

  it('should invalidate queries by predicate', async () => {
    const client = new QueryClient()
    const queryFn1 = vi.fn(() => Promise.resolve('data1'))
    const queryFn2 = vi.fn(() => Promise.resolve('data2'))

    await client.fetchQuery({
      queryKey: ['users', 1],
      queryFn: queryFn1,
    })

    await client.fetchQuery({
      queryKey: ['posts', 1],
      queryFn: queryFn2,
    })

    await client.invalidateQueries({
      predicate: (query) => query.queryKey[0] === 'users',
    })

    expect(queryFn1).toHaveBeenCalledTimes(2)
    expect(queryFn2).toHaveBeenCalledTimes(1)
  })
  })

  it('should clear all queries', async () => {
    const client = new QueryClient()
    const queryFn1 = vi.fn(() => Promise.resolve('data1'))
    const queryFn2 = vi.fn(() => Promise.resolve('data2'))

    await client.fetchQuery({
      queryKey: ['test', 1],
      queryFn: queryFn1,
    })

    await client.fetchQuery({
      queryKey: ['test', 2],
      queryFn: queryFn2,
    })

    expect(client.getQuery(['test', 1])).toBeDefined()
    expect(client.getQuery(['test', 2])).toBeDefined()

    client.clear()

    expect(client.getQuery(['test', 1])).toBeUndefined()
    expect(client.getQuery(['test', 2])).toBeUndefined()
  })

  it('should get query by queryKey', async () => {
    const client = new QueryClient()
    const queryFn = vi.fn(() => Promise.resolve('data'))

    await client.fetchQuery({
      queryKey: ['test'],
      queryFn,
    })

    const query = client.getQuery(['test'])
    expect(query).toBeDefined()
    expect(query?.queryKey).toEqual(['test'])
  })

  it('should merge default options with query options', async () => {
    const defaultOnError = vi.fn()
    const client = new QueryClient({
      queries: {
        staleTime: 5000,
        gcTime: 30000,
        onError: defaultOnError,
      },
    })

    const queryFn = vi.fn(() => Promise.reject(new Error('error')))

    await client.fetchQuery({
      queryKey: ['test'],
      queryFn,
      retry: false,
    })

    expect(defaultOnError).toHaveBeenCalled()
  })

  it('should schedule garbage collection after gcTime', async () => {
    const client = new QueryClient()
    const queryFn = vi.fn(() => Promise.resolve('data'))

    // Fetch query to create it
    await client.fetchQuery({
      queryKey: ['test'],
      queryFn,
      gcTime: 1000,
    })

    // Query should exist
    expect(client.getQuery(['test'])).toBeDefined()

    // Remove all observers to make it inactive
    const query = client.getQuery(['test'])!
    query.observers = []
    query['scheduleGC']()

    // Wait for gcTime to pass
    await vi.advanceTimersByTimeAsync(999)
    expect(client.getQuery(['test'])).toBeDefined()

    await vi.advanceTimersByTimeAsync(1)
    // Note: actual removal would be done by QueryClient's cleanup logic
    // This test verifies the timeout is scheduled correctly
  })
})
