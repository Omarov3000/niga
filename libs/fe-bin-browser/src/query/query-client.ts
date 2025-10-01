import { hashQueryKey } from './hash-query-key'

export type QueryData = unknown

export interface QueryState {
  data: QueryData
  dataUpdatedAt: Date
  error: Error | undefined
  errorUpdatedAt: Date
  fetchStatus: 'fetching' | 'paused' | 'idle'
  fetchFailureCount: number
  fetchFailureReason: Error | undefined
  status: 'pending' | 'error' | 'success'
  isInvalidated: boolean
}

type RetryDelayFunction<TError = Error> = (failureCount: number, error: TError) => number
type ShouldRetryFunction<TError = Error> = (failureCount: number, error: TError) => boolean
type RetryValue<TError> = boolean | number | ShouldRetryFunction<TError>
type RetryDelayValue<TError> = number | RetryDelayFunction<TError>

export interface QueryOptions {
  queryKey: unknown[]
  queryFn: (options: { signal: AbortSignal; queryKey: unknown[] }) => Promise<unknown>
  retry?: RetryValue<Error>
  retryDelay?: RetryDelayValue<Error>
  throwOnError?: boolean
  onError?: (error: Error, query: Query) => void
  initialData?: unknown
  gcTime?: number
  staleTime?: number
  enabled?: boolean | ((query: Query) => boolean)
  refetchOnWindowFocus?: boolean
  refetchInterval?: number
  meta?: Record<string, any>
}

export type FetchStatus = 'fetching' | 'paused' | 'idle'

export interface QueryFilters {
  type?: 'all' | 'active' | 'inactive'
  exact?: boolean
  predicate?: (query: Query) => boolean
  queryKey?: unknown[]
  stale?: boolean
  fetchStatus?: FetchStatus
}

export type GlobalQuerySettings = Pick<QueryOptions, 'staleTime' | 'gcTime' | 'onError' | 'refetchOnWindowFocus'>

const globalDefaultQuerySettings: GlobalQuerySettings = {
  staleTime: 1000, // 1 second
  gcTime: 5 * 60 * 1000, // 5 minutes
  refetchOnWindowFocus: true,
}

export class Query {
  queryKey: unknown[]
  queryHash: string
  options: QueryOptions
  state: QueryState
  observers: Array<(state: QueryState) => void> = []

  private abortController: AbortController | undefined
  private gcTimeout: ReturnType<typeof setTimeout> | undefined
  private refetchIntervalId: ReturnType<typeof setInterval> | undefined

  constructor(options: QueryOptions) {
    this.queryKey = options.queryKey
    this.queryHash = hashQueryKey(options.queryKey)
    this.options = options

    this.state = {
      data: options.initialData,
      dataUpdatedAt: new Date(),
      error: undefined,
      errorUpdatedAt: new Date(),
      fetchStatus: 'idle',
      fetchFailureCount: 0,
      fetchFailureReason: undefined,
      status: options.initialData !== undefined ? 'success' : 'pending',
      isInvalidated: false,
    }
  }

  subscribe(observer: (state: QueryState) => void): () => void {
    this.observers.push(observer)
    this.clearGCTimeout()

    return () => {
      const index = this.observers.indexOf(observer)
      if (index > -1) {
        this.observers.splice(index, 1)
      }

      if (this.observers.length === 0) {
        this.scheduleGC()
      }
    }
  }

  private notify(): void {
    for (const observer of this.observers) {
      observer(this.state)
    }
  }

  async fetch(): Promise<QueryState> {
    if (this.state.fetchStatus === 'fetching') {
      return this.state
    }

    this.abortController = new AbortController()

    this.state = {
      ...this.state,
      fetchStatus: 'fetching',
      isInvalidated: false,
    }
    this.notify()

    try {
      const data = await this.options.queryFn({
        signal: this.abortController.signal,
        queryKey: this.queryKey,
      })

      this.state = {
        ...this.state,
        data,
        dataUpdatedAt: new Date(),
        error: undefined,
        fetchStatus: 'idle',
        fetchFailureCount: 0,
        fetchFailureReason: undefined,
        status: 'success',
      }
      this.notify()

      return this.state
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      this.state = {
        ...this.state,
        error: err,
        errorUpdatedAt: new Date(),
        fetchStatus: 'idle',
        fetchFailureCount: this.state.fetchFailureCount + 1,
        fetchFailureReason: err,
        status: 'error',
      }
      this.notify()

      if (this.options.onError) {
        this.options.onError(err, this)
      }

      const shouldRetry = this.shouldRetry(err)
      if (shouldRetry) {
        const delay = this.getRetryDelay(err)
        await new Promise((resolve) => setTimeout(resolve, delay))
        return this.fetch()
      }

      if (this.options.throwOnError) {
        throw err
      }

      return this.state
    }
  }

  private shouldRetry(error: Error): boolean {
    const { retry } = this.options

    if (retry === undefined) {
      return this.state.fetchFailureCount <= 3
    }

    if (typeof retry === 'boolean') {
      return retry && this.state.fetchFailureCount <= 3
    }

    if (typeof retry === 'number') {
      return this.state.fetchFailureCount <= retry
    }

    return retry(this.state.fetchFailureCount, error)
  }

  private getRetryDelay(error: Error): number {
    const { retryDelay } = this.options

    if (retryDelay === undefined) {
      return Math.min(1000 * 2 ** this.state.fetchFailureCount, 30000)
    }

    if (typeof retryDelay === 'number') {
      return retryDelay
    }

    return retryDelay(this.state.fetchFailureCount, error)
  }

  async invalidate(): Promise<QueryState> {
    this.state = {
      ...this.state,
      isInvalidated: true,
    }
    this.notify()

    return this.fetch()
  }

  async cancel(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = undefined
    }

    this.state = {
      ...this.state,
      fetchStatus: 'idle',
    }
    this.notify()
  }

  isStale(staleTime: number): boolean {
    if (this.state.status !== 'success') {
      return false
    }

    const timeSinceUpdate = Date.now() - this.state.dataUpdatedAt.getTime()
    return timeSinceUpdate > staleTime
  }

  private scheduleGC(): void {
    this.clearGCTimeout()
    const gcTime = this.options.gcTime ?? globalDefaultQuerySettings.gcTime ?? 5 * 60 * 1000

    this.gcTimeout = setTimeout(() => {
      // Will be removed by QueryClient
    }, gcTime)
  }

  private clearGCTimeout(): void {
    if (this.gcTimeout) {
      clearTimeout(this.gcTimeout)
      this.gcTimeout = undefined
    }
  }

  destroy(): void {
    this.cancel()
    this.clearGCTimeout()
    if (this.refetchIntervalId) {
      clearInterval(this.refetchIntervalId)
      this.refetchIntervalId = undefined
    }
  }
}

export class QueryClient {
  private queries = new Map<string, Query>()
  private defaultOptions: GlobalQuerySettings

  constructor(defaultOptions?: Partial<GlobalQuerySettings>) {
    this.defaultOptions = {
      ...globalDefaultQuerySettings,
      ...defaultOptions,
    }
  }

  private getQueryHash(queryKey: unknown[]): string {
    return hashQueryKey(queryKey)
  }

  private mergeOptions(options: QueryOptions): QueryOptions {
    return {
      ...options,
      staleTime: options.staleTime ?? this.defaultOptions.staleTime,
      gcTime: options.gcTime ?? this.defaultOptions.gcTime,
      onError: options.onError ?? this.defaultOptions.onError,
      refetchOnWindowFocus: options.refetchOnWindowFocus ?? this.defaultOptions.refetchOnWindowFocus,
    }
  }

  private getOrCreateQuery(options: QueryOptions): Query {
    const queryHash = this.getQueryHash(options.queryKey)
    let query = this.queries.get(queryHash)

    if (!query) {
      query = new Query(this.mergeOptions(options))
      this.queries.set(queryHash, query)
    } else {
      // Update options if query exists
      query.options = this.mergeOptions(options)
    }

    return query
  }

  async fetchQuery(options: QueryOptions): Promise<QueryData> {
    const query = this.getOrCreateQuery(options)
    const state = await query.fetch()
    return state.data
  }

  ensureQueryData(options: QueryOptions): QueryData | undefined {
    const query = this.getOrCreateQuery(options)
    const staleTime = options.staleTime ?? this.defaultOptions.staleTime ?? 0

    if (query.state.status === 'success' && !query.isStale(staleTime)) {
      return query.state.data
    }

    // Trigger fetch in background
    query.fetch()

    return query.state.status === 'success' ? query.state.data : undefined
  }

  prefetchQuery(options: QueryOptions): QueryData | undefined {
    const query = this.getOrCreateQuery(options)
    const staleTime = options.staleTime ?? this.defaultOptions.staleTime ?? 0

    if (query.state.status !== 'success' || query.isStale(staleTime)) {
      query.fetch()
    }

    return query.state.data
  }

  async invalidateQueries(filters: QueryFilters = {}): Promise<Query[]> {
    const queriesToInvalidate = this.getQueries(filters)
    const promises = queriesToInvalidate.map((query) => query.invalidate())
    await Promise.all(promises)
    return queriesToInvalidate
  }

  private getQueries(filters: QueryFilters): Query[] {
    const queries = Array.from(this.queries.values())

    return queries.filter((query) => {
      // Filter by type
      if (filters.type) {
        const isActive = query.observers.length > 0
        if (filters.type === 'active' && !isActive) return false
        if (filters.type === 'inactive' && isActive) return false
      }

      // Filter by queryKey
      if (filters.queryKey) {
        if (filters.exact) {
          if (hashQueryKey(query.queryKey) !== hashQueryKey(filters.queryKey)) {
            return false
          }
        } else {
          // Partial match - filters.queryKey must be prefix of query.queryKey
          const filterKey = filters.queryKey
          if (filterKey.length > query.queryKey.length) return false
          for (let i = 0; i < filterKey.length; i++) {
            if (hashQueryKey([filterKey[i]]) !== hashQueryKey([query.queryKey[i]])) {
              return false
            }
          }
        }
      }

      // Filter by stale
      if (filters.stale !== undefined) {
        const staleTime = query.options.staleTime ?? this.defaultOptions.staleTime ?? 0
        const isStale = query.isStale(staleTime)
        if (filters.stale !== isStale) return false
      }

      // Filter by fetchStatus
      if (filters.fetchStatus && query.state.fetchStatus !== filters.fetchStatus) {
        return false
      }

      // Filter by predicate
      if (filters.predicate && !filters.predicate(query)) {
        return false
      }

      return true
    })
  }

  clear(): void {
    for (const query of this.queries.values()) {
      query.destroy()
    }
    this.queries.clear()
  }

  getQuery(queryKey: unknown[]): Query | undefined {
    const queryHash = this.getQueryHash(queryKey)
    return this.queries.get(queryHash)
  }
}
