import type { AnyRouter, AnyProcedure, MiddlewareContext } from '../core/types'
import { executeMiddlewares } from '../core/middleware'
import { RpcError } from '../core/error'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface HttpServerConfig<TCtx = any> {
  appRouter: AnyRouter
  port?: number
  cors?: string
  createContext?: (req: IncomingMessage) => TCtx | Promise<TCtx>
}

function findProcedure(router: AnyRouter, path: string[]): AnyProcedure | null {
  let current: any = router

  for (const segment of path) {
    current = current[segment]
    if (!current) return null
  }

  if (current && '_def' in current) {
    return current as AnyProcedure
  }

  return null
}

export async function handleRpcRequest<TCtx>(
  appRouter: AnyRouter,
  req: IncomingMessage,
  res: ServerResponse,
  createContext?: (req: IncomingMessage) => TCtx | Promise<TCtx>
): Promise<void> {
  try {
    // Parse request body
    const body = await new Promise<string>((resolve, reject) => {
      let data = ''
      req.on('data', (chunk) => (data += chunk))
      req.on('end', () => resolve(data))
      req.on('error', reject)
    })

    const { input, type } = JSON.parse(body)
    const url = new URL(req.url || '', `http://${req.headers.host}`)
    const pathSegments = url.pathname.split('/').filter(Boolean)

    const procedure = findProcedure(appRouter, pathSegments)
    if (!procedure) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: { code: 404, message: 'Procedure not found' } }))
      return
    }

    // Validate input
    let validatedInput = input
    if (procedure._def.inputSchema) {
      const inputResult = procedure._def.inputSchema._zod.run(
        { value: input, issues: [] },
        { async: false }
      )

      if (inputResult instanceof Promise) {
        const resolved = await inputResult
        if (resolved.issues.length > 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              ok: false,
              error: { code: 400, message: 'Input validation failed', issues: resolved.issues },
            })
          )
          return
        }
        validatedInput = resolved.value
      } else {
        if (inputResult.issues.length > 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              ok: false,
              error: { code: 400, message: 'Input validation failed', issues: inputResult.issues },
            })
          )
          return
        }
        validatedInput = inputResult.value
      }
    }

    // Create context
    const baseCtx = createContext ? await createContext(req) : {}

    const cookies = new Map<string, string>()
    const cookieHeader = req.headers.cookie
    if (cookieHeader) {
      cookieHeader.split(';').forEach((cookie) => {
        const [name, value] = cookie.trim().split('=')
        if (name && value) cookies.set(name, value)
      })
    }

    const setCookieHeaders: string[] = []

    const context: MiddlewareContext = {
      path: pathSegments.join('.'),
      type: procedure._def.type,
      ctx: baseCtx,
      input: validatedInput,
      meta: procedure._def.meta,
      getHeader: (name: string) => req.headers[name.toLowerCase()] as string | undefined,
      getCookie: (name: string) => cookies.get(name),
      setCookie: (cookie) => {
        let cookieStr = `${cookie.name}=${cookie.value}`
        if (cookie.path) cookieStr += `; Path=${cookie.path}`
        if (cookie.domain) cookieStr += `; Domain=${cookie.domain}`
        if (cookie.maxAge) cookieStr += `; Max-Age=${cookie.maxAge}`
        if (cookie.expires) cookieStr += `; Expires=${cookie.expires}`
        if (cookie.httpOnly) cookieStr += '; HttpOnly'
        if (cookie.secure) cookieStr += '; Secure'
        if (cookie.sameSite) cookieStr += `; SameSite=${cookie.sameSite}`
        setCookieHeaders.push(cookieStr)
      },
    }

    // Execute middlewares and handler
    const result = await executeMiddlewares(
      procedure._def.middlewares,
      context,
      async (ctx, finalInput) => {
        return procedure._def.handler({
          ctx,
          input: finalInput,
          meta: procedure._def.meta,
          path: pathSegments.join('.'),
          type: procedure._def.type,
        })
      }
    )

    if (!result.ok) {
      res.writeHead(result.error.code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: { code: result.error.code, message: result.error.message } }))
      return
    }

    // Validate output
    let output = result.data
    if (procedure._def.outputSchema) {
      const outputResult = procedure._def.outputSchema._zod.run(
        { value: output, issues: [] },
        { async: false }
      )

      if (outputResult instanceof Promise) {
        const resolved = await outputResult
        if (resolved.issues.length > 0) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              ok: false,
              error: { code: 500, message: 'Output validation failed', issues: resolved.issues },
            })
          )
          return
        }
        output = resolved.value
      } else {
        if (outputResult.issues.length > 0) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              ok: false,
              error: { code: 500, message: 'Output validation failed', issues: outputResult.issues },
            })
          )
          return
        }
        output = outputResult.value
      }
    }

    const headers: Record<string, string | string[]> = {
      'Content-Type': 'application/json',
    }

    if (setCookieHeaders.length > 0) {
      headers['Set-Cookie'] = setCookieHeaders
    }

    res.writeHead(200, headers)
    res.end(JSON.stringify({ ok: true, data: output }))
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        ok: false,
        error: {
          code: 500,
          message: error instanceof Error ? error.message : 'Internal server error',
        },
      })
    )
  }
}

export function createHttpServer<TCtx>(config: HttpServerConfig<TCtx>): void {
  // This is a placeholder for Node.js http server
  // In a real implementation, you would use:
  // import { createServer } from 'node:http'
  // const server = createServer((req, res) => handleRpcRequest(config.appRouter, req, res, config.createContext))
  // server.listen(config.port || 3000)
  throw new Error('createHttpServer requires Node.js environment')
}
