import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { nanoid } from 'nanoid'
import { Mutation, QueryClient, type MutationOptions, type MutationState } from './query-client'
import { useQueryClient } from './query-client-provider'

export interface UseMutationOptions<TData = unknown, TError = Error, TVariables = unknown>
  extends MutationOptions<TData, TError, TVariables> {}

export interface UseMutationResult<TData = unknown, TError = Error, TVariables = unknown> {
  data: TData | undefined
  error: TError | undefined
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

export function useMutation<TData = unknown, TError = Error, TVariables = unknown>(
  options: UseMutationOptions<TData, TError, TVariables>,
  queryClient?: QueryClient
): UseMutationResult<TData, TError, TVariables> {
  const contextClient = useQueryClient(true)
  const client = queryClient ?? contextClient

  if (!client) {
    throw new Error('useMutation requires either a queryClient parameter or QueryClientProvider')
  }

  const [id] = useState(() => nanoid())
  const mutationRef = useRef<Mutation<TData, TError, TVariables> | null>(null)

  // Create mutation on first render
  if (!mutationRef.current) {
    mutationRef.current = client.addMutation<TData, TError, TVariables>(id, options)
  }
  const mutation = mutationRef.current

  // Update mutation options
  useEffect(() => {
    mutation.options = client['mergeMutationOptions'](options)
  }, [JSON.stringify(options)])

  // Subscribe to mutation state changes
  const subscribe = useCallback((callback: () => void) => mutation.subscribe(callback), [mutation])
  const getSnapshot = useCallback(() => mutation.state, [mutation])
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
