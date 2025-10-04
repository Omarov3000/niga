export { initRpc } from './core/builder'
export { RpcError } from './core/error'
export { createRpcClient } from './client/client'
export { createRpcOptionsProxy } from './client/hooks'
export { createRpcTestClient } from './test/test-client'
export { createHttpServer, handleRpcRequest } from './server/adapter'

export type {
  Middleware,
  MiddlewareOptions,
  MiddlewareResult,
  Cookie,
  AnyRouter,
  AnyProcedure,
  Procedure,
  inferRouterInputs,
  inferRouterOutputs,
} from './core/types'

export type { RpcBuilder, ProcedureBuilder, RpcBuilderConfig } from './core/builder'
export type { RpcClientConfig } from './client/client'
export type { RpcOptionsConfig } from './client/hooks'
export type { TestClientConfig } from './test/test-client'
export type { HttpServerConfig } from './server/adapter'
