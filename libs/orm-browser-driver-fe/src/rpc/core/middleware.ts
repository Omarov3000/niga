import type { Middleware, MiddlewareOptions, MiddlewareResult, MiddlewareContext } from './types'
import { RpcError } from './error'

export async function executeMiddlewares<TCtx, TMeta>(
  middlewares: Middleware<any, any, TMeta>[],
  context: MiddlewareContext<TCtx, TMeta>,
  finalHandler: (ctx: any, input: any) => Promise<any>
): Promise<MiddlewareResult> {
  let currentCtx = context.ctx
  let currentInput = context.input

  const executeChain = async (index: number): Promise<MiddlewareResult> => {
    if (index >= middlewares.length) {
      try {
        const result = await finalHandler(currentCtx, currentInput)
        return { ok: true, data: result }
      } catch (error) {
        if (error instanceof RpcError) {
          return { ok: false, error }
        }
        return {
          ok: false,
          error: new RpcError(500, error instanceof Error ? error.message : 'Internal server error'),
        }
      }
    }

    const middleware = middlewares[index]
    const opts: MiddlewareOptions<any, TMeta> = {
      ...context,
      ctx: currentCtx,
      input: currentInput,
      next: async (overrides = {}) => {
        if (overrides.ctx !== undefined) {
          currentCtx = overrides.ctx as any
        }
        if (overrides.input !== undefined) {
          currentInput = overrides.input
        }
        return executeChain(index + 1)
      },
    }

    try {
      return await middleware(opts)
    } catch (error) {
      if (error instanceof RpcError) {
        return { ok: false, error }
      }
      return {
        ok: false,
        error: new RpcError(500, error instanceof Error ? error.message : 'Middleware error'),
      }
    }
  }

  return executeChain(0)
}
