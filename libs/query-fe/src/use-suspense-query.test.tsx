import React, { Suspense } from 'react'
import { expect, expectTypeOf, it, vi, beforeEach, afterEach, describe } from 'vitest'
import { useSuspenseQuery } from './use-suspense-query'
import { QueryClient } from './query-client'
import { render } from './_test-helpers'

const queryClient = new QueryClient()

beforeEach(() => {
  queryClient.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
})

it('should suspend and then render data', async () => {
  const queryFn = vi.fn(() => Promise.resolve('data'))

  function TestComponent() {
    const result = useSuspenseQuery(
      {
        queryKey: ['test'],
        queryFn,
      },
      queryClient
    )

    // Type tests
    expectTypeOf(result.data).toEqualTypeOf<string>()

    return <div data-testid="result">{result.data}</div>
  }

  const { see } = render(
    <Suspense fallback={<div data-testid="loading">Loading...</div>}>
      <TestComponent />
    </Suspense>
  )

  await see('loading', 'Loading...')
  await see('result', 'data')
})

it('should throw error when query fails', async () => {
  const error = new Error('fetch failed (test error - it is ok to see it in test logs)')
  const queryFn = vi.fn(() => Promise.reject(error))

  function TestComponent() {
    const { data } = useSuspenseQuery(
      {
        queryKey: ['test'],
        queryFn,
        retry: false,
      },
      queryClient
    )
    return <div data-testid="result">{data as string}</div>
  }

  class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error?: Error }> {
    constructor(props: { children: React.ReactNode }) {
      super(props)
      this.state = { hasError: false }
    }

    static getDerivedStateFromError(error: Error) {
      return { hasError: true, error }
    }

    render() {
      if (this.state.hasError) {
        return <div data-testid="error">{this.state.error?.message}</div>
      }
      return this.props.children
    }
  }

  const { see } = render(
    <ErrorBoundary>
      <Suspense fallback={<div data-testid="loading">Loading...</div>}>
        <TestComponent />
      </Suspense>
    </ErrorBoundary>
  )

  await see('loading', 'Loading...')
  await see('error', 'fetch failed (test error - it is ok to see it in test logs)')
})
