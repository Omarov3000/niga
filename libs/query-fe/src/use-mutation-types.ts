import type { MutationOptions } from './query-client'

export interface UseMutationOptions<TData = unknown, TVariables = unknown>
  extends MutationOptions<TData, TVariables> {}
