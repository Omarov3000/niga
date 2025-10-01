import { hashQueryKey } from './hash-query-key'
import { deepEqual } from 'fast-equals'

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
  promise: Promise<QueryState> | null
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
export type GlobalMutationSettings = Pick<MutationOptions, 'retry' | 'retryDelay' | 'onError'>

const globalDefaultQuerySettings: GlobalQuerySettings = {
  staleTime: 1000, // 1 second
  gcTime: 5 * 60 * 1000, // 5 minutes
  refetchOnWindowFocus: true,
}

const globalDefaultMutationSettings: GlobalMutationSettings = {
  retry: false,
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
  private enabled: boolean = true

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
      promise: null,
    }
  }

  subscribe(observer: (state: QueryState) => void): () => void {
    const isFirstObserver = this.observers.length === 0
    this.observers.push(observer)
    this.clearGCTimeout()

    // Only auto-fetch on first subscription (mount), not on re-subscribes
    if (isFirstObserver && this.enabled) {
      this.maybeAutoFetch()
      this.maybeStartRefetchInterval()
    }

    return () => {
      const index = this.observers.indexOf(observer)
      if (index > -1) {
        this.observers.splice(index, 1)
      }

      if (this.observers.length === 0) {
        this.scheduleGC()
        this.stopRefetchInterval()
      }
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return
    }

    this.enabled = enabled

    if (enabled) {
      this.maybeStartRefetchInterval()
      this.maybeAutoFetch()
    } else {
      this.stopRefetchInterval()
    }
  }

  private maybeAutoFetch(): void {
    if (!this.enabled || this.observers.length === 0) return

    // Don't auto-fetch if already fetching
    if (this.state.fetchStatus === 'fetching') {
      return
    }

    // Auto-fetch if pending or stale success
    if (this.state.status === 'pending') {
      this.fetch()
      return
    }

    if (this.state.status === 'success') {
      const staleTime = this.options.staleTime ?? 0
      if (this.isStale(staleTime)) {
        this.fetch()
      }
    }
  }

  private maybeStartRefetchInterval(): void {
    if (!this.enabled || this.observers.length === 0 || !this.options.refetchInterval) return

    this.stopRefetchInterval()
    this.refetchIntervalId = setInterval(() => {
      if (this.enabled) {
        this.fetch()
      }
    }, this.options.refetchInterval)
  }

  private stopRefetchInterval(): void {
    if (this.refetchIntervalId) {
      clearInterval(this.refetchIntervalId)
      this.refetchIntervalId = undefined
    }
  }

  private notify(): void {
    for (const observer of this.observers) {
      observer(this.state)
    }
  }

  async fetch(): Promise<QueryState> {
    if (this.state.fetchStatus === 'fetching' && this.state.promise) {
      return this.state.promise
    }

    this.abortController = new AbortController()

    const executeFetch = async (): Promise<QueryState> => {
      try {
        const data = await this.options.queryFn({
          signal: this.abortController!.signal,
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
          promise: null,
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
          promise: null,
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

    const promise = executeFetch()

    this.state = {
      ...this.state,
      fetchStatus: 'fetching',
      isInvalidated: false,
      promise,
    }
    this.notify()

    return promise
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

    // If already fetching, just return current state (don't wait for fetch to complete)
    if (this.state.fetchStatus === 'fetching') {
      return this.state
    }

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
      promise: null,
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
    this.stopRefetchInterval()
  }
}

export interface MutationState<TData = unknown, TError = Error, TVariables = unknown> {
  data: TData | undefined
  error: TError | undefined
  failureCount: number
  failureReason: TError | undefined
  status: 'idle' | 'pending' | 'error' | 'success'
  isPaused: boolean
  variables: TVariables | undefined
  submittedAt: Date | undefined
}

type RetryMutationDelayFunction<TError = Error> = (failureCount: number, error: TError) => number
type ShouldRetryMutationFunction<TError = Error> = (failureCount: number, error: TError) => boolean
type RetryMutationValue<TError> = boolean | number | ShouldRetryMutationFunction<TError>
type RetryMutationDelayValue<TError> = number | RetryMutationDelayFunction<TError>

export interface MutationOptions<TData = unknown, TError = Error, TVariables = unknown> {
  mutationFn: (variables: TVariables) => Promise<TData>
  onMutate?: (variables: TVariables) => Promise<void> | void
  onSuccess?: (data: TData, variables: TVariables, mutation: Mutation<TData, TError, TVariables>) => Promise<void> | void
  onError?: (error: TError, variables: TVariables, mutation: Mutation<TData, TError, TVariables>) => Promise<void> | void
  onSettled?: (data: TData | undefined, error: TError | undefined, variables: TVariables, mutation: Mutation<TData, TError, TVariables>) => Promise<void> | void
  retry?: RetryMutationValue<TError>
  retryDelay?: RetryMutationDelayValue<TError>
  throwOnError?: boolean
  meta?: Record<string, any>
}

export class Mutation<TData = unknown, TError = Error, TVariables = unknown> {
  id: string
  options: MutationOptions<TData, TError, TVariables>
  state: MutationState<TData, TError, TVariables>
  observers: Array<(state: MutationState<TData, TError, TVariables>) => void> = []

  constructor(id: string, options: MutationOptions<TData, TError, TVariables>) {
    this.id = id
    this.options = options
    this.state = {
      data: undefined,
      error: undefined,
      failureCount: 0,
      failureReason: undefined,
      status: 'idle',
      isPaused: false,
      variables: undefined,
      submittedAt: undefined,
    }
  }

  subscribe(observer: (state: MutationState<TData, TError, TVariables>) => void): () => void {
    this.observers.push(observer)
    return () => {
      const index = this.observers.indexOf(observer)
      if (index > -1) {
        this.observers.splice(index, 1)
      }
    }
  }

  private notify(): void {
    for (const observer of this.observers) {
      observer(this.state)
    }
  }

  async mutate(variables: TVariables): Promise<TData> {
    const execute = async (): Promise<TData> => {
      this.state = {
        ...this.state,
        status: 'pending',
        variables,
        submittedAt: new Date(),
        isPaused: false,
      }
      this.notify()

      try {
        if (this.options.onMutate) {
          await this.options.onMutate(variables)
        }

        const data = await this.options.mutationFn(variables)

        this.state = {
          ...this.state,
          data,
          error: undefined,
          failureCount: 0,
          failureReason: undefined,
          status: 'success',
        }
        this.notify()

        if (this.options.onSuccess) {
          await this.options.onSuccess(data, variables, this)
        }

        if (this.options.onSettled) {
          await this.options.onSettled(data, undefined, variables, this)
        }

        return data
      } catch (error) {
        const err = error as TError

        this.state = {
          ...this.state,
          error: err,
          failureCount: this.state.failureCount + 1,
          failureReason: err,
          status: 'error',
        }
        this.notify()

        if (this.options.onError) {
          await this.options.onError(err, variables, this)
        }

        if (this.options.onSettled) {
          await this.options.onSettled(undefined, err, variables, this)
        }

        const shouldRetry = this.shouldRetry(err)
        if (shouldRetry) {
          const delay = this.getRetryDelay(err)
          await new Promise((resolve) => setTimeout(resolve, delay))
          return this.mutate(variables)
        }

        if (this.options.throwOnError) {
          throw err
        }

        throw err
      }
    }

    return execute()
  }

  private shouldRetry(error: TError): boolean {
    const { retry } = this.options

    if (retry === undefined) {
      return false
    }

    if (typeof retry === 'boolean') {
      return retry && this.state.failureCount <= 3
    }

    if (typeof retry === 'number') {
      return this.state.failureCount <= retry
    }

    return retry(this.state.failureCount, error)
  }

  private getRetryDelay(error: TError): number {
    const { retryDelay } = this.options

    if (retryDelay === undefined) {
      return Math.min(1000 * 2 ** this.state.failureCount, 30000)
    }

    if (typeof retryDelay === 'number') {
      return retryDelay
    }

    return retryDelay(this.state.failureCount, error)
  }

  reset(): void {
    this.state = {
      data: undefined,
      error: undefined,
      failureCount: 0,
      failureReason: undefined,
      status: 'idle',
      isPaused: false,
      variables: undefined,
      submittedAt: undefined,
    }
    this.notify()
  }

  destroy(): void {
    this.observers = []
  }
}

export class QueryClient {
  private queries = new Map<string, Query>()
  private mutations = new Map<string, Mutation>()
  private defaultOptions: GlobalQuerySettings
  private defaultMutationOptions: GlobalMutationSettings
  private windowFocusUnsubscribe?: () => void
  private windowFocusListenerSetup = false

  constructor(defaultOptions?: { queries?: Partial<GlobalQuerySettings>; mutations?: Partial<GlobalMutationSettings> }) {
    this.defaultOptions = {
      ...globalDefaultQuerySettings,
      ...defaultOptions?.queries,
    }
    this.defaultMutationOptions = {
      ...globalDefaultMutationSettings,
      ...defaultOptions?.mutations,
    }
  }

  private ensureWindowFocusListener(): void {
    if (this.windowFocusListenerSetup) return
    this.windowFocusListenerSetup = true


    const handleFocus = () => {
      const queries = Array.from(this.queries.values())
      for (const query of queries) {
        // Only refetch if query has active observers (is mounted)
        if (query.observers.length > 0 && query.options.refetchOnWindowFocus) {
          const staleTime = query.options.staleTime ?? this.defaultOptions.staleTime ?? 0
          const isStale = query.isStale(staleTime)
          if (isStale) {
            query.fetch()
          }
        }
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocus)
      this.windowFocusUnsubscribe = () => window.removeEventListener('focus', handleFocus)
    }
  }

  getQueryHash(queryKey: unknown[]): string {
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

  syncQueryOptions(options: QueryOptions): Query {
    const queryHash = this.getQueryHash(options.queryKey)
    let query = this.queries.get(queryHash)

    if (!query) {
      const mergedOptions = this.mergeOptions(options)
      query = new Query(mergedOptions)
      // Set initial enabled state from options
      const enabled = typeof mergedOptions.enabled === 'function'
        ? mergedOptions.enabled(query)
        : mergedOptions.enabled ?? true
      query['enabled'] = enabled
      this.queries.set(queryHash, query)

      // Set up window focus listener if this query needs it (delayed to avoid race conditions)
      if (mergedOptions.refetchOnWindowFocus) {
        queueMicrotask(() => this.ensureWindowFocusListener())
      }
    } else {
      // Evaluate new enabled value
      const newEnabledValue = typeof options.enabled === 'function'
        ? options.enabled(query)
        : options.enabled ?? true

      // Compare options excluding enabled function (compare rest of options)
      const { enabled: _oldEnabled, ...oldOptionsWithoutEnabled } = query.options
      const { enabled: _newEnabled, ...newOptionsWithoutEnabled } = options

      const mergedNewOptions = this.mergeOptions(newOptionsWithoutEnabled)
      const optionsChanged = !deepEqual(oldOptionsWithoutEnabled, mergedNewOptions)
      const enabledChanged = query['enabled'] !== newEnabledValue

      if (optionsChanged || enabledChanged) {
        // Update query options
        query.options = this.mergeOptions(options)
        if (enabledChanged) {
          query.setEnabled(newEnabledValue)
        }
      }
    }

    return query
  }

  private getOrCreateQuery(options: QueryOptions): Query {
    return this.syncQueryOptions(options)
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
    for (const mutation of this.mutations.values()) {
      mutation.destroy()
    }
    this.mutations.clear()
  }

  destroy(): void {
    this.clear()
    if (this.windowFocusUnsubscribe) {
      this.windowFocusUnsubscribe()
      this.windowFocusUnsubscribe = undefined
    }
  }

  getQuery(queryKey: unknown[]): Query | undefined {
    const queryHash = this.getQueryHash(queryKey)
    return this.queries.get(queryHash)
  }

  getMutation(mutationId: string): Mutation | undefined {
    return this.mutations.get(mutationId)
  }

  removeMutation(mutationId: string): void {
    const mutation = this.mutations.get(mutationId)
    if (mutation) {
      mutation.destroy()
      this.mutations.delete(mutationId)
    }
  }

  private mergeMutationOptions<TData = unknown, TError = Error, TVariables = unknown>(
    options: MutationOptions<TData, TError, TVariables>
  ): MutationOptions<TData, TError, TVariables> {
    return {
      ...options,
      retry: options.retry ?? (this.defaultMutationOptions.retry as RetryMutationValue<TError>),
      retryDelay: options.retryDelay ?? (this.defaultMutationOptions.retryDelay as RetryMutationDelayValue<TError>),
      onError: options.onError ?? (this.defaultMutationOptions.onError as MutationOptions<TData, TError, TVariables>['onError']),
    }
  }

  addMutation<TData = unknown, TError = Error, TVariables = unknown>(
    mutationId: string,
    options: MutationOptions<TData, TError, TVariables>
  ): Mutation<TData, TError, TVariables> {
    const mergedOptions = this.mergeMutationOptions(options)
    const mutation = new Mutation<TData, TError, TVariables>(mutationId, mergedOptions)
    this.mutations.set(mutationId, mutation as unknown as Mutation)
    return mutation
  }
}
