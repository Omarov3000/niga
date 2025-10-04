import { describe, it, expect, expectTypeOf } from 'vitest'
import { initRpc, createRpcTestClient, RpcError } from './index'
import { s } from '@w/schema'

interface Ctx {
  db: {
    users: { id: string; name: string }[]
  }
  getUser: () => { id: string }
}

interface Meta {
  docs?: string
}

const db = {
  users: [
    { id: '1', name: 'Alice' },
    { id: '2', name: 'Bob' },
  ],
}

const t = initRpc.context<Ctx>().meta<Meta>().create({
  defaultCtx: {
    db,
    getUser: () => {
      throw new Error('Not authenticated')
    },
  },
})

const publicProcedure = t.procedure

const protectedProcedure = publicProcedure.use(async (opts) => {
  const user = { id: 'test-user-id' }
  return opts.next({ ctx: { ...opts.ctx, getUser: () => user } })
})

it('executes basic query', async () => {
  const appRouter = t.router({
    users: {
      list: publicProcedure
        .query(async ({ ctx }) => {
          return ctx.db.users
        }),
    },
  })

  const client = createRpcTestClient({ appRouter })

  expectTypeOf(client.users.list.query).toEqualTypeOf<(input?: undefined) => Promise<{ id: string; name: string }[]>>()

  const result = await client.users.list.query()

  expect(result).toMatchObject([
    { id: '1', name: 'Alice' },
    { id: '2', name: 'Bob' },
  ])

  expectTypeOf(result).toEqualTypeOf<{ id: string; name: string }[]>()
})

it('executes mutation with input validation', async () => {
  const appRouter = t.router({
    users: {
      create: publicProcedure
        .input(s.object({ name: s.string() }))
        .mutation(async ({ input, ctx }) => {
          const newUser = { id: String(ctx.db.users.length + 1), name: input.name }
          ctx.db.users.push(newUser)
          return newUser
        }),
    },
  })

  const client = createRpcTestClient({ appRouter })

  expectTypeOf(client.users.create.mutate).toEqualTypeOf<(input: { name: string }) => Promise<{ id: string; name: string }>>()

  const result = await client.users.create.mutate({ name: 'Charlie' })

  expect(result).toMatchObject({ id: '3', name: 'Charlie' })
  expectTypeOf(result.id).toEqualTypeOf<string>()
})

it('validates input schema', async () => {
  const appRouter = t.router({
    users: {
      create: publicProcedure
        .input(s.object({ name: s.string() }))
        .output(s.object({ id: s.string() }))
        .mutation(async ({ input }) => {
          return { id: '1' }
        }),
    },
  })

  const client = createRpcTestClient({ appRouter })

  try {
    await client.users.create.mutate({ name: 123 } as any)
    expect.fail('Should have thrown')
  } catch (error) {
    expect(error).toBeInstanceOf(RpcError)
    const rpcError = error as RpcError
    expect(rpcError.code).toBe(400)
    expect(rpcError.message).toBe('Input validation failed')
    expect(rpcError.cause).toBeInstanceOf(s.SchemaError)
  }
})

it('applies middleware correctly', async () => {
  const appRouter = t.router({
    users: {
      me: protectedProcedure
        .query(async ({ ctx }) => {
          return ctx.getUser()
        }),
    },
  })

  const client = createRpcTestClient({ appRouter })

  const result = await client.users.me.query()

  expect(result).toEqual({ id: 'test-user-id' })
  expectTypeOf(result).toEqualTypeOf<{ id: string }>()
})

it('handles nested routers', async () => {
  const appRouter = t.router({
    users: {
      profile: {
        get: publicProcedure
          .input(s.object({ id: s.string() }))
          .output(s.object({ id: s.string(), name: s.string() }))
          .query(async ({ input, ctx }) => {
            const user = ctx.db.users.find((u) => u.id === input.id)
            if (!user) throw new RpcError(404, 'User not found')
            return user
          }),
      },
    },
  })

  const client = createRpcTestClient({ appRouter })

  const result = await client.users.profile.get.query({ id: '1' })

  expect(result).toEqual({ id: '1', name: 'Alice' })
  expectTypeOf(result).toEqualTypeOf<{ id: string; name: string }>()
})

it('infers router types correctly', () => {
  const appRouter = t.router({
    users: {
      list: publicProcedure
        .output(s.array(s.object({ id: s.string(), name: s.string() })))
        .query(async ({ ctx }) => ctx.db.users),
      create: publicProcedure
        .input(s.object({ name: s.string() }))
        .output(s.object({ id: s.string() }))
        .mutation(async ({ input }) => ({ id: '1' })),
    },
  })

  type AppRouter = typeof appRouter

  type UsersList = AppRouter['users']['list']
  type UsersCreate = AppRouter['users']['create']

  expect(appRouter.users.list._def.type).toBe('query')
  expect(appRouter.users.create._def.type).toBe('mutation')
})

it('handles middleware context merging', async () => {
  const logMiddleware = t.procedure.use(async (opts) => {
    const logs: string[] = []
    return opts.next({ ctx: { ...opts.ctx, logs } })
  })

  const appRouter = t.router({
    test: logMiddleware
      .output(s.array(s.string()))
      .query(async ({ ctx }) => {
        return (ctx as any).logs
      }),
  })

  const client = createRpcTestClient({ appRouter })

  const result = await client.test.query()

  expect(result).toEqual([])
})

it('handles errors thrown in handlers', async () => {
  const appRouter = t.router({
    error: publicProcedure.query(async () => {
      throw new RpcError(500, 'Something went wrong')
    }),
  })

  const client = createRpcTestClient({ appRouter })

  await expect(client.error.query()).rejects.toThrow('Something went wrong')
})

it('validates output schema', async () => {
  const appRouter = t.router({
    test: publicProcedure
      .output(s.object({ id: s.string() }))
      .query(async () => {
        return { id: 123 } as any
      }),
  })

  const client = createRpcTestClient({ appRouter })

  try {
    await client.test.query()
    expect.fail('Should have thrown')
  } catch (error) {
    expect(error).toBeInstanceOf(RpcError)
    const rpcError = error as RpcError
    expect(rpcError.code).toBe(500)
    expect(rpcError.message).toBe('Output validation failed')
    expect(rpcError.cause).toBeInstanceOf(s.SchemaError)
  }
})

it('supports procedures without input', async () => {
  const appRouter = t.router({
    health: publicProcedure
      .output(s.object({ status: s.string() }))
      .query(async () => {
        return { status: 'ok' }
      }),
  })

  const client = createRpcTestClient({ appRouter })

  const result = await client.health.query()

  expect(result).toEqual({ status: 'ok' })
  expectTypeOf(result).toEqualTypeOf<{ status: string }>()
})

it('supports procedures without output schema', async () => {
  const appRouter = t.router({
    test: publicProcedure.query(async () => {
      return { arbitrary: 'data', number: 42 }
    }),
  })

  const client = createRpcTestClient({ appRouter })

  const result = await client.test.query()

  expect(result).toEqual({ arbitrary: 'data', number: 42 })
})

it('infers output from .output() schema when provided', async () => {
  const appRouter = t.router({
    withOutputSchema: publicProcedure
      .input(s.object({ name: s.string() }))
      .output(s.object({ id: s.string(), success: s.boolean() }))
      .mutation(({ input }) => ({ id: '1', success: true })),
  })

  const client = createRpcTestClient({ appRouter })

  expectTypeOf(client.withOutputSchema.mutate).toEqualTypeOf<
    (input: { name: string }) => Promise<{ id: string; success: boolean }>
  >()

  const result = await client.withOutputSchema.mutate({ name: 'test' })
  expect(result).toEqual({ id: '1', success: true })
  expectTypeOf(result).toEqualTypeOf<{ id: string; success: boolean }>()
})

describe('rpc type inference', () => {
  it('infers all input/output combinations correctly', () => {
    const userSchema = s.object({ id: s.string(), name: s.string() })
    const inputSchema = s.object({ name: s.string() })
    const outputSchema = s.object({ id: s.string(), success: s.boolean() })

    const appRouter = t.router({
      // No input, no output - infers from return
      noInputNoOutput: publicProcedure.query(() => ({ value: 42 })),

      // No input, with output schema
      noInputWithOutput: publicProcedure.output(userSchema).query(() => ({ id: '1', name: 'Alice' })),

      // With input, no output - infers from return
      withInputNoOutput: publicProcedure.input(inputSchema).mutation(({ input }) => ({
        id: '1',
        name: input.name,
      })),

      // With input, with output schema
      withInputWithOutput: publicProcedure
        .input(inputSchema)
        .output(outputSchema)
        .mutation(() => ({ id: '1', success: true })),

      // Async without output schema
      asyncNoOutput: publicProcedure.input(inputSchema).query(async ({ input }) => ({
        name: input.name,
        timestamp: Date.now(),
      })),

      // Async with output schema
      asyncWithOutput: publicProcedure
        .input(inputSchema)
        .output(userSchema)
        .query(async () => ({ id: '1', name: 'Alice' })),
    })

    const client = createRpcTestClient({ appRouter })

    // No input = optional undefined parameter
    expectTypeOf(client.noInputNoOutput.query).toEqualTypeOf<
      (input?: undefined) => Promise<{ value: number }>
    >()

    expectTypeOf(client.noInputWithOutput.query).toEqualTypeOf<
      (input?: undefined) => Promise<{ id: string; name: string }>
    >()

    // With input = required parameter
    expectTypeOf(client.withInputNoOutput.mutate).toEqualTypeOf<
      (input: { name: string }) => Promise<{ id: string; name: string }>
    >()

    // Output schema overrides inferred type
    expectTypeOf(client.withInputWithOutput.mutate).toEqualTypeOf<
      (input: { name: string }) => Promise<{ id: string; success: boolean }>
    >()

    // Async handlers work the same
    expectTypeOf(client.asyncNoOutput.query).toEqualTypeOf<
      (input: { name: string }) => Promise<{ name: string; timestamp: number }>
    >()

    expectTypeOf(client.asyncWithOutput.query).toEqualTypeOf<
      (input: { name: string }) => Promise<{ id: string; name: string }>
    >()
  })
})
