import type { Middleware, Procedure, AnyRouter, ProcedureContext } from './types'

export interface RpcBuilderConfig<TCtx, TMeta> {
  defaultCtx?: TCtx
}

export interface ProcedureBuilder<TCtx = any, TMeta = any> {
  input<TSchema extends { _zod: { output: any } }>(
    schema: TSchema
  ): ProcedureBuilder<TCtx, TMeta> & { _inputSchema: TSchema }

  output<TSchema extends { _zod: { output: any } }>(
    schema: TSchema
  ): ProcedureBuilder<TCtx, TMeta> & { _outputSchema: TSchema }

  meta(metadata: TMeta): ProcedureBuilder<TCtx, TMeta>

  use<TNewCtx = TCtx>(
    middleware: Middleware<TCtx, TNewCtx, TMeta>
  ): ProcedureBuilder<TNewCtx, TMeta>

  query<TOutput>(
    handler: (opts: ProcedureContext<TCtx, TMeta>) => Promise<TOutput> | TOutput
  ): Procedure<any, TOutput, TCtx, TMeta>

  mutation<TOutput>(
    handler: (opts: ProcedureContext<TCtx, TMeta>) => Promise<TOutput> | TOutput
  ): Procedure<any, TOutput, TCtx, TMeta>

  _middlewares: Middleware<any, any, TMeta>[]
  _inputSchema?: any
  _outputSchema?: any
  _meta?: TMeta
}

function createProcedureBuilder<TCtx, TMeta>(
  middlewares: Middleware<any, any, TMeta>[] = []
): ProcedureBuilder<TCtx, TMeta> {
  const builder: any = {
    _middlewares: middlewares,
    _inputSchema: undefined,
    _outputSchema: undefined,
    _meta: undefined,

    input(schema: any) {
      const newBuilder = createProcedureBuilder<TCtx, TMeta>(this._middlewares)
      newBuilder._inputSchema = schema
      newBuilder._outputSchema = this._outputSchema
      newBuilder._meta = this._meta
      return newBuilder
    },

    output(schema: any) {
      const newBuilder = createProcedureBuilder<TCtx, TMeta>(this._middlewares)
      newBuilder._inputSchema = this._inputSchema
      newBuilder._outputSchema = schema
      newBuilder._meta = this._meta
      return newBuilder
    },

    meta(metadata: TMeta) {
      const newBuilder = createProcedureBuilder<TCtx, TMeta>(this._middlewares)
      newBuilder._inputSchema = this._inputSchema
      newBuilder._outputSchema = this._outputSchema
      newBuilder._meta = metadata
      return newBuilder
    },

    use(middleware: Middleware<any, any, TMeta>) {
      return createProcedureBuilder<any, TMeta>([...this._middlewares, middleware])
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
      }
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
      }
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
      router: <T extends AnyRouter>(routes: T): T => routes,
      procedure: createProcedureBuilder<any, any>(),
    }
  },
}
