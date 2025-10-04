we need to implement rpc library that can be used for fe to be communication as well as for between threads communication on fe.

```ts
// shared (but it runs on be)

interface Meta {
  docs?: string
}

// dependency injection
interface Ctx {
  db: ...
  getUser: () => { id: string }
}
type PublicCtx = Omit<Ctx, 'user'>

const t = initRpc.context<Ctx>().meta<Meta>().create({ defaultCtx: { db, getUser: () => { throw new Error('Not implemented') } }})
const router = t.router
const publicProcedure = t.procedure

interface MiddlewareOptions<Ctx, Meta> {
  path: string
  type: 'query' | 'mutation'
  ctx: Ctx
  input: any
  meta: Meta

  next: (opts: Partial<{ ctx: Ctx, input: any, meta: Meta }>) => Promise<{ ok: true; data: any } | { ok: false; error: RpcError }>

  getHeader: (name: string) => string
  getCookie: (name: string) => string
  setCookie: (cookie: Cookie) => void
}

interface Cookie {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  expires?: Date | string;
  maxAge?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

type ClientErrorCode = 400 | 401 | 403 | 404 | 429
type ServerErrorCode = 500
type ErrorCode = ClientErrorCode | ServerErrorCode
class RpcError extends Error {
  code: ErrorCode
  constructor(code: ErrorCode, message: string){
    super(message)
    this.code = code
  }
}

const protectedProcedure = publicProcedure.use((opts) => {
  const userToken = opts.getCookie('userToken')
  const user = parseToken(userToken)
  return opts.next({ ctx: { ...opts.ctx, user } })
})

const appRouter = router({
  users: {
    create: protectedProcedure
      .input(s.object({ name: s.string() }))
      .mutation(async ({ input, ctx }) => {
        await ctx.db.users.insert({ name: input.name });
        return { success: true }; // type is inferred from the return type of the mutation
      }),
    list: protectedProcedure
      .output(s.array(s.object({ id: s.string(), name: s.string() })))
      .query(async ({ ctx }) => {
        return await ctx.db.users.select().execute();
      }),
  },
})

export AppRouter = typeof appRouter // this type can be imported on fe

type RouterInput = inferRouterInputs<AppRouter>;
type RouterOutput = inferRouterOutputs<AppRouter>;

type UsersCreateInput = RouterInput['users']['create'];
type UsersCreateOutput = RouterOutput['users']['create'];

const client = createRpcTestClient({ appRouter, ctx: (ctx) => ({ ...ctx, getUser: () => ({ id: '1' }) }) })
const result = await client.users.create.mutate({ name: 'John' })

// client usage fe

const rpcClient = createRpcClient<AppRouter>({
  url: 'http://localhost:3000',
  queryClient: {} as any,
});

const result = await rpcClient.users.create.mutate({ name: 'John' })
const options = rpcClient.users.create.mutationOptions()

// be specific

createHttpServer({ appRouter, port: 3000, cors: '*' }) // it should use latest node api to implement a simple http server
```
