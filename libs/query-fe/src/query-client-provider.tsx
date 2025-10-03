import React, { createContext, useContext } from 'react'
import type { QueryClient } from './query-client'

const QueryClientContext = createContext<QueryClient | undefined>(undefined)

export interface QueryClientProviderProps {
  client: QueryClient
  children: React.ReactNode
}

export function QueryClientProvider({ client, children }: QueryClientProviderProps) {
  return <QueryClientContext.Provider value={client}>{children}</QueryClientContext.Provider>
}

export function useQueryClient(): QueryClient
export function useQueryClient(optional: true): QueryClient | undefined
export function useQueryClient(optional?: boolean): QueryClient | undefined {
  const client = useContext(QueryClientContext)
  if (!client && !optional) {
    throw new Error('useQueryClient must be used within a QueryClientProvider')
  }
  return client
}
