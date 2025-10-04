import type { RpcError } from './error'

export interface Cookie {
  name: string
  value: string
  path?: string
  domain?: string
  expires?: Date | string
  maxAge?: number
  secure?: boolean
  httpOnly?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

export interface MiddlewareContext<TCtx = any, TMeta = any> {
  path: string
  type: 'query' | 'mutation'
  ctx: TCtx
  input: any
  meta: TMeta
  getHeader: (name: string) => string | undefined
  getCookie: (name: string) => string | undefined
  setCookie: (cookie: Cookie) => void
}

export type MiddlewareResult<T = any> =
  | { ok: true; data: T }
  | { ok: false; error: RpcError }

export interface MiddlewareOptions<TCtx = any, TMeta = any> extends MiddlewareContext<TCtx, TMeta> {
  next: <TNewCtx = TCtx>(opts?: Partial<{ ctx: TNewCtx; input: any; meta: TMeta }>) => Promise<MiddlewareResult>
}

export type Middleware<TCtx = any, TNewCtx = TCtx, TMeta = any> = (
  opts: MiddlewareOptions<TCtx, TMeta>
) => Promise<MiddlewareResult>

export interface ProcedureContext<TCtx = any, TMeta = any> {
  ctx: TCtx
  input: any
  meta: TMeta
  path: string
  type: 'query' | 'mutation'
}

export type AnyProcedure = Procedure<any, any, any, any>
export type AnyRouter = Record<string, AnyProcedure | Record<string, any>>

export interface Procedure<TInput = any, TOutput = any, TCtx = any, TMeta = any> {
  _def: {
    type: 'query' | 'mutation'
    inputSchema?: any
    outputSchema?: any
    handler: (opts: ProcedureContext<TCtx, TMeta>) => Promise<TOutput> | TOutput
    middlewares: Middleware<any, any, TMeta>[]
    meta?: TMeta
  }
}

export type inferRouterInputs<TRouter extends AnyRouter> = {
  [K in keyof TRouter]: TRouter[K] extends Procedure<infer TInput, any, any, any>
    ? TInput
    : TRouter[K] extends AnyRouter
    ? inferRouterInputs<TRouter[K]>
    : never
}

export type inferRouterOutputs<TRouter extends AnyRouter> = {
  [K in keyof TRouter]: TRouter[K] extends Procedure<any, infer TOutput, any, any>
    ? TOutput
    : TRouter[K] extends AnyRouter
    ? inferRouterOutputs<TRouter[K]>
    : never
}
