export type ClientErrorCode = 400 | 401 | 403 | 404 | 429
export type ServerErrorCode = 500
export type ErrorCode = ClientErrorCode | ServerErrorCode

export class RpcError extends Error {
  code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'RpcError'
  }
}
