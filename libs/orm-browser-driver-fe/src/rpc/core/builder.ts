import type { Middleware, Procedure, AnyRouter, ProcedureContext } from './types'

export interface RpcBuilderConfig<TCtx, TMeta> {
  defaultCtx?: TCtx
}

export interface ProcedureBuilder<TCtx = any, TMeta = any, TInputSchema = undefined, TOutputSchema = undefined> {
  input<TSchema extends { _zod: { output: any } }>(
    schema: TSchema
  ): ProcedureBuilder<TCtx, TMeta, TSchema, TOutputSchema>

  output<TSchema extends { _zod: { output: any } }>(
    schema: TSchema
  ): ProcedureBuilder<TCtx, TMeta, TInputSchema, TSchema>

  meta(metadata: TMeta): ProcedureBuilder<TCtx, TMeta, TInputSchema, TOutputSchema>

  use<TNewCtx = TCtx>(
    middleware: Middleware<TCtx, TNewCtx, TMeta>
  ): ProcedureBuilder<TNewCtx, TMeta, TInputSchema, TOutputSchema>

  query<TOutput>(
    handler: (opts: Omit<ProcedureContext<TCtx, TMeta>, 'input'> & {
      input: TInputSchema extends { _zod: { output: infer TInput } } ? TInput : undefined
    }) => Promise<TOutput> | TOutput
  ): Procedure<
    TInputSchema extends { _zod: { output: infer TInput } } ? TInput : undefined,
    TOutputSchema extends { _zod: { output: infer TOut } } ? TOut : TOutput,
    TCtx,
    TMeta
  >

  mutation<TOutput>(
    handler: (opts: Omit<ProcedureContext<TCtx, TMeta>, 'input'> & {
      input: TInputSchema extends { _zod: { output: infer TInput } } ? TInput : undefined
    }) => Promise<TOutput> | TOutput
  ): Procedure<
    TInputSchema extends { _zod: { output: infer TInput } } ? TInput : undefined,
    TOutputSchema extends { _zod: { output: infer TOut } } ? TOut : TOutput,
    TCtx,
    TMeta
  >

  _middlewares: Middleware<any, any, TMeta>[]
  _inputSchema?: any
  _outputSchema?: any
  _meta?: TMeta
}

function createProcedureBuilder<TCtx, TMeta, TInputSchema = undefined, TOutputSchema = undefined>(
  middlewares: Middleware<any, any, TMeta>[] = []
): ProcedureBuilder<TCtx, TMeta, TInputSchema, TOutputSchema> {
  const builder: any = {
    _middlewares: middlewares,
    _inputSchema: undefined,
    _outputSchema: undefined,
    _meta: undefined,

    input(schema: any) {
      const newBuilder = createProcedureBuilder<TCtx, TMeta, any, TOutputSchema>(this._middlewares)
      newBuilder._inputSchema = schema
      newBuilder._outputSchema = this._outputSchema
      newBuilder._meta = this._meta
      return newBuilder
    },

    output(schema: any) {
      const newBuilder = createProcedureBuilder<TCtx, TMeta, TInputSchema, any>(this._middlewares)
      newBuilder._inputSchema = this._inputSchema
      newBuilder._outputSchema = schema
      newBuilder._meta = this._meta
      return newBuilder
    },

    meta(metadata: TMeta) {
      const newBuilder = createProcedureBuilder<TCtx, TMeta, TInputSchema, TOutputSchema>(this._middlewares)
      newBuilder._inputSchema = this._inputSchema
      newBuilder._outputSchema = this._outputSchema
      newBuilder._meta = metadata
      return newBuilder
    },

    use(middleware: Middleware<any, any, TMeta>) {
      return createProcedureBuilder<any, TMeta, TInputSchema, TOutputSchema>([...this._middlewares, middleware])
    },

    query(handler: any) {
      return {
        _def: {
          type: 'query' as const,
          inputSchema: this._inputSchema,
          outputSchema: this._outputSchema,
          handler,
          middlewares: this._middlewares,
          meta: this._meta,
        },
      } as any
    },

    mutation(handler: any) {
      return {
        _def: {
          type: 'mutation' as const,
          inputSchema: this._inputSchema,
          outputSchema: this._outputSchema,
          handler,
          middlewares: this._middlewares,
          meta: this._meta,
        },
      } as any
    },
  }

  return builder
}

export interface RpcBuilder<TCtx, TMeta> {
  context<TNewCtx>(): RpcBuilder<TNewCtx, TMeta>
  meta<TNewMeta>(): RpcBuilder<TCtx, TNewMeta>
  create(config?: RpcBuilderConfig<TCtx, TMeta>): {
    router: <T extends AnyRouter>(routes: T) => T
    procedure: ProcedureBuilder<TCtx, TMeta>
  }
}

export const initRpc: RpcBuilder<any, any> = {
  context() {
    return this as any
  },

  meta() {
    return this as any
  },

  create(config?: RpcBuilderConfig<any, any>) {
    return {
      router: <T extends AnyRouter>(routes: T): T & { _rpcConfig?: RpcBuilderConfig<any, any> } => {
        const router = routes as any
        router._rpcConfig = config
        return router
      },
      procedure: createProcedureBuilder<any, any>(),
    }
  },
}
