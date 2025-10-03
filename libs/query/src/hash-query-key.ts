export type QueryKey = readonly unknown[]

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

export function hashQueryKey(queryKey: QueryKey): string {
  return JSON.stringify(queryKey, (_, val) =>
    isPlainObject(val)
      ? Object.keys(val)
          .sort()
          .reduce((result, key) => {
            if (key === 'tel') return result

            result[key] = val[key]
            return result
            // biome-ignore lint/suspicious/noExplicitAny: <explanation>
          }, {} as any)
      : val
  )
}
