When working on frontend tasks you cannot run dev commands because an engineer needs to run them and give you feedback.
Never use `tsx` or `tsc` or `node`. Always use `pnpm exec vite-node scriptName.ts`.

Never add `.js` in the file imports.

Never use multiple assertion calls if they can be replace with a single `toMatchObject` call.

```ts
// bad
expect(result).toHaveProperty('mdast')
expect(result).toHaveProperty('resources')
expect(result.mdast.type).toBe('root')

// good
expect(result).toMatchObject({
  mdast: {
    type: 'root'
  },
  resources: expect.any(Map)
})
```

Tests cannot interact with file system. Use in memory file generation (eg `makeBlackSquare32`).

Write fewer longer tests.
