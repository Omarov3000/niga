import { Suspense, use, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { ReactSuspenseCache } from './react-suspense-cache'
import { render } from './_test-helpers'

it('works without react', () => {
    const cache = new ReactSuspenseCache()
    const promise = Promise.resolve('value')

    expect(cache.has('test')).toBe(false)

    cache.put('test', promise)
    expect(cache.has('test')).toBe(true)
    expect(cache.get('test')).toBe(promise)

    cache.delete('test')
    expect(cache.has('test')).toBe(false)

    cache.put('test', promise)
    cache.clear()
    expect(cache.has('test')).toBe(false)
  })

it('should work with use hook and Suspense for async data', async () => {
    const cache = new ReactSuspenseCache()

    function TestComponent() {
      const [key, setKey] = useState<string | null>(null)

      if (key === null) {
        return (
          <button
            data-testid="fetch-btn"
            onClick={() => {
              const promise = Promise.resolve('fetched-data')
              cache.put('fetch-key', promise)
              setKey('fetch-key')
            }}
          >
            Fetch Data
          </button>
        )
      }

      const value = use(cache.get(key)!)
      return <div data-testid="result">{value}</div>
    }

    const { click, see } = render(
      <Suspense fallback={<div data-testid="loading">Loading...</div>}>
        <TestComponent />
      </Suspense>
    )
    await click('fetch-btn')
    // await see('loading') // FALLBACK_THROTTLE_MS = 300 exists so we can see loading in tests. if we set it to 0 we won't see loading states because react is slower than resolved promise (eg with 10ms delay)
    await see('result', 'fetched-data')
  })
