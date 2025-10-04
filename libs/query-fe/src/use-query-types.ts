import type { QueryOptions } from './query-client'

export interface UseQueryOptions<TQueryFnData = unknown, TData = TQueryFnData>
  extends Omit<QueryOptions, 'queryFn'> {
  queryFn: (options: { signal: AbortSignal; queryKey: unknown[] }) => Promise<TQueryFnData>
  select?: (data: TQueryFnData) => TData
}
