import type { AnyRouter, AnyProcedure, Procedure, MiddlewareContext } from '../core/types'
import { executeMiddlewares } from '../core/middleware'

type InferProcedureInput<T> = T extends Procedure<infer TInput, any, any, any> ? TInput : never
type InferProcedureOutput<T> = T extends Procedure<any, infer TOutput, any, any> ? TOutput : never

type CreateClientRouter<TRouter extends AnyRouter> = {
  [K in keyof TRouter]: TRouter[K] extends AnyProcedure
    ? {
        query: (input?: InferProcedureInput<TRouter[K]>) => Promise<InferProcedureOutput<TRouter[K]>>
        mutate: (input?: InferProcedureInput<TRouter[K]>) => Promise<InferProcedureOutput<TRouter[K]>>
      }
    : TRouter[K] extends AnyRouter
    ? CreateClientRouter<TRouter[K]>
    : never
}

export interface TestClientConfig<TRouter extends AnyRouter, TCtx> {
  appRouter: TRouter
  ctx?: (baseCtx: any) => TCtx
}

export function createRpcTestClient<TRouter extends AnyRouter>(
  config: TestClientConfig<TRouter, any>
): CreateClientRouter<TRouter> {
  const { appRouter } = config
  const executeRequest = async (procedure: AnyProcedure, input: any, path: string) => {
    const { inputSchema, outputSchema, handler, middlewares, meta } = procedure._def

    // Validate input
    if (inputSchema) {
      const inputResult = inputSchema._zod.run({ value: input, issues: [] }, { async: false })
      if (inputResult instanceof Promise) {
        const resolved = await inputResult
        if (resolved.issues.length > 0) {
          throw new Error(`Input validation failed: ${JSON.stringify(resolved.issues)}`)
        }
        input = resolved.value
      } else {
        if (inputResult.issues.length > 0) {
          throw new Error(`Input validation failed: ${JSON.stringify(inputResult.issues)}`)
        }
        input = inputResult.value
      }
    }

    // Build middleware context - ensure we get the base context from config
    const baseCtx = config?.ctx ? config.ctx({}) : {}
    const context: MiddlewareContext = {
      path,
      type: procedure._def.type,
      ctx: baseCtx,
      input,
      meta,
      getHeader: () => undefined,
      getCookie: () => undefined,
      setCookie: () => {},
    }

    // Execute middlewares and handler
    const result = await executeMiddlewares(
      middlewares,
      context,
      async (ctx, validatedInput) => {
        return handler({ ctx, input: validatedInput, meta, path, type: procedure._def.type })
      }
    )

    if (!result.ok) {
      throw result.error
    }

    let output = result.data

    // Validate output
    if (outputSchema) {
      const outputResult = outputSchema._zod.run({ value: output, issues: [] }, { async: false })
      if (outputResult instanceof Promise) {
        const resolved = await outputResult
        if (resolved.issues.length > 0) {
          throw new Error(`Output validation failed: ${JSON.stringify(resolved.issues)}`)
        }
        output = resolved.value
      } else {
        if (outputResult.issues.length > 0) {
          throw new Error(`Output validation failed: ${JSON.stringify(outputResult.issues)}`)
        }
        output = outputResult.value
      }
    }

    return output
  }

  const buildProxy = (router: AnyRouter, basePath: string[] = []): any => {
    return new Proxy(
      {},
      {
        get(_target, prop: string) {
          const value = router[prop]

          if (!value) {
            throw new Error(`Procedure or router not found: ${[...basePath, prop].join('.')}`)
          }

          // If it's a procedure, return query/mutate methods
          if ('_def' in value) {
            const procedure = value as AnyProcedure
            const path = [...basePath, prop].join('.')

            return {
              query: (input: any) => executeRequest(procedure, input, path),
              mutate: (input: any) => executeRequest(procedure, input, path),
            }
          }

          // If it's a nested router, recurse
          return buildProxy(value as AnyRouter, [...basePath, prop])
        },
      }
    )
  }

  return buildProxy(appRouter)
}
