we need to implement rpc library that can be used for fe to be communication as well as for between threads communication on fe.

```ts
// on server (be)

// dependency injection
interface Ctx {
  db: ...
  user: { id: string }
}
type PublicCtx = Omit<Ctx, 'user'>

const procedure = createProcedure<Ctx>()

const publicProcedure = createProcedure<PublicCtx>()

const appRouter = router({
  users: {
    create: procedure
      .input(s.object({ name: s.string() }))
      .mutation(async ({ input, ctx }) => {
        await ctx.db.users.insert({ name: input.name });
        return { success: true };
      }),
    list: procedure
      .query(async ({ ctx }) => {
        return await ctx.db.users.select().execute();
      }),
  },
})

export AppRouter = typeof appRouter // this type can be imported on fe
```
