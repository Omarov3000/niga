These are guidelines for implementing query library. You can deviate or extend them but you need to clearly indicate it using comments.
```ts
type QueryData = unknown

interface QueryState {
  data: QueryData
  dataUpdatedAt: Date
  error: Error | undefined
  errorUpdatedAt: Date
  fetchStatus: 'fetching' | 'paused' | 'idle' // if no network then the query is paused
  fetchFailureCount: number
  fetchFailureReason: Error | undefined
  status: 'pending' | 'error' | 'success'
  isInvalidated: boolean;
}

type RetryDelayFunction = (failureCount: number, error: Error) => number;
type RetryValue = boolean | number | ShouldRetryFunction;
type RetryDelayValue = number | RetryDelayFunction;
type ShouldRetryFunction = (failureCount: number, error: Error) => boolean;

interface QueryOptions {
  queryKey: unknown[]
  queryFn: (options: { signal: AbortSignal; queryKey: unknown[] }) => Promise<unknown>
  retry?: RetryValue;
  retryDelay?: RetryDelayValue;
  throwOnError?: boolean;
  onError?: (error: Error, query: Query) => void // non react-query prop to show notification
  initialData?: unknown;

  gcTime: number;
  staleTime: number;
  enabled: boolean | (query: Query) => boolean;

  refetchOnWindowFocus?: boolean;
  refetchInterval?: number

  meta?: Record<string, any>;
}

interface Query {
  queryKey: unknown[];
  queryHash: string;
  options: QueryOptions;
  state: QueryState;
  observers: Array<(state: QueryState) => void>;

  invalidate(): Promise<QueryState>
  cancel(): Promise<void>
}

export type GlobalQuerySettings = Pick<QueryOptions, 'staleTime' | 'cacheTime' | 'onError' | 'refetchOnWindowFocus'>
const globalDefaultQuerySettings: GlobalQuerySettings = {
  staleTime: sec,
  gcTime: 5min,
  refetchOnWindowFocus: true,
}

// An inactive query is a query that still exists in the cache but currently has no active observers
interface QueryFilters {
  type?: 'all' | 'active' | 'inactive';
  exact?: boolean;
  predicate?: (query: Query) => boolean;
  queryKey?: unknown[];
  stale?: boolean; // Include or exclude stale queries
  fetchStatus?: FetchStatus; // Include queries matching their fetchStatus
}

interface QueryClient {
  fetchQuery(options: QueryOptions): Promise<QueryData>
  ensureQueryData(options: QueryOptions): QueryData | undefined
  prefetchQuery(options: QueryOptions): QueryData | undefined
  invalidateQueries(options: QueryFilters): Promise<Query[]> // array of invalidated queries after they are re-fetched
  fetchInfiniteQuery(options: QueryOptions): Promise<QueryData>
  clear(): void
}

const {
  data,
  error,
  isError,
  isFetching,
  isLoading,
  isPending,
  isRefetching,
  isSuccess,
  refetch,
  status,
} = useQuery(
  {
    queryKey,
    queryFn,
    gcTime,
    enabled,
    initialData,
    meta,
    refetchInterval,
    refetchOnWindowFocus,
    retry,
    retryDelay,
    select, // accept query data and return new data
    staleTime,
    throwOnError,
  },
  queryClient,
)

`useSuspenseQuery`
Options: The same as for useQuery, except for: throwOnError, enabled
Returns: Same object as useQuery, except that: data is guaranteed to be defined, status is either success or error

const {
  data,
  error,
  fetchNextPage,
  hasNextPage,
  isFetching,
  isFetchingNextPage,
  status,
} = useInfiniteQuery({
  queryKey: ['projects'],
  queryFn: fetchProjects,
  initialPageParam: 0,
  getNextPageParam: (lastPage, pages) => lastPage.nextCursor,
})
```

Mutations:

mutations should be cleaned from the state after they finish and when the component is unmounted

```ts
const {
  data,
  error,
  isError,
  isIdle,
  isPending,
  isSuccess,
  failureCount,
  mutate,
  mutateAsync,
  reset,
  status,
} = useMutation(
  {
    mutationFn,
    meta,
    onError,
    onMutate,
    onSettled,
    onSuccess,
    retry,
    retryDelay,
    throwOnError,
  },
  queryClient,
)

mutate(variables) variables is input to mutationFn

tip: use const [id] = useState(() => nanoid()) inside useMutation.
```
Advanced features:
structuralSharing
