import { Suspense, useState } from 'react'
import { expect, it } from 'vitest'
import { ReactSuspenseCache } from './react-suspense-cache'
import { usePromiseWrapper } from './use-promise-wrapper'
import { render } from '../../_test-helpers'

it('works without react', () => {
  const cache = new ReactSuspenseCache()
  const wrapper = { status: 'initial' as const, promise: Promise.resolve('value') }

  expect(cache.has('test')).toBe(false)

  cache.put('test', wrapper)
  expect(cache.has('test')).toBe(true)
  expect(cache.get('test')).toBe(wrapper)

  cache.delete('test')
  expect(cache.has('test')).toBe(false)

  cache.put('test', wrapper)
  cache.clear()
  expect(cache.has('test')).toBe(false)
})

it('should work with usePromiseWrapper hook and Suspense for async data', async () => {
  const cache = new ReactSuspenseCache()

  function TestComponent() {
    const [key, setKey] = useState<string | null>(null)

    if (key === null) {
      return (
        <button
          data-testid="fetch-btn"
          onClick={() => {
            const wrapper = { status: 'initial' as const, promise: Promise.resolve('fetched-data') }
            cache.put('fetch-key', wrapper)
            setKey('fetch-key')
          }}
        >
          Fetch Data
        </button>
      )
    }

    const value = usePromiseWrapper<string>(cache.get(key)!)
    return <div data-testid="result">{value}</div>
  }

  const { click, see } = render(
    <Suspense fallback={<div data-testid="loading">Loading...</div>}>
      <TestComponent />
    </Suspense>
  )
  await click('fetch-btn')
  await see('result', 'fetched-data')
})
