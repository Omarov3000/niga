we need to implement rpc library that can be used for fe to be communication as well as for between threads communication on fe.

```ts
// on server (be)

// dependency injection
interface Ctx {
  db: ...
}
const procedure = createProcedure<Ctx>()

const appRouter = router({
  users: {
    create: procedure
      .input(s.object({ name: s.string() }))
      .mutation()
  }
})

export AppRouter = typeof appRouter // this type can be imported on fe
```
