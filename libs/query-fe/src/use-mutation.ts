import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { nanoid } from 'nanoid'
import { QueryClient } from './query-client'
import { useQueryClient } from './query-client-provider'
import type { UseMutationOptions } from './use-mutation-types'

export type { UseMutationOptions } from './use-mutation-types'

export interface UseMutationResult<TData = unknown, TVariables = unknown> {
  data: TData | undefined
  error: Error | undefined
  isError: boolean
  isIdle: boolean
  isPending: boolean
  isSuccess: boolean
  failureCount: number
  mutate: (variables: TVariables) => void
  mutateAsync: (variables: TVariables) => Promise<TData>
  reset: () => void
  status: 'idle' | 'pending' | 'error' | 'success'
}

export function useMutation<TData = unknown, TVariables = unknown>(
  options: UseMutationOptions<TData, TVariables>,
  queryClient?: QueryClient
): UseMutationResult<TData, TVariables> {
  const contextClient = useQueryClient(true)
  const client = queryClient ?? contextClient

  if (!client) {
    throw new Error('useMutation requires either a queryClient parameter or QueryClientProvider')
  }

  const [id] = useState(() => nanoid())

  // Sync mutation options and get mutation (runs on every render)
  const mutation = client.syncMutationOptions<TData, TVariables>(id, options)

  // Subscribe to mutation state changes
  const subscribe = useCallback((callback: () => void) => mutation.subscribe(callback), [id])
  const getSnapshot = useCallback(() => mutation.state, [id])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      client.removeMutation(id)
    }
  }, [client, id])

  const mutate = useCallback(
    (variables: TVariables) => {
      mutation.mutate(variables).catch(() => {
        // Error is handled in mutation state
      })
    },
    [mutation]
  )

  const mutateAsync = useCallback(
    (variables: TVariables) => {
      return mutation.mutate(variables)
    },
    [mutation]
  )

  const reset = useCallback(() => {
    mutation.reset()
  }, [mutation])

  return {
    data: state.data,
    error: state.error,
    isError: state.status === 'error',
    isIdle: state.status === 'idle',
    isPending: state.status === 'pending',
    isSuccess: state.status === 'success',
    failureCount: state.failureCount,
    mutate,
    mutateAsync,
    reset,
    status: state.status,
  }
}
