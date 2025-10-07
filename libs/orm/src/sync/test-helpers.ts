import { OrmNodeDriver } from '../orm-node-driver'
import { o } from '../schema/builder'
import { internalSyncTables } from './internal-tables'
import { RemoteDb, RemoteDbClient, TestRemoteDb, RemoteDbServer } from './remote-db'
import { AlwaysOnlineDetector, ControllableOnlineDetector } from './test-online-detector'

export async function _makeRemoteDb<TSchema extends Record<string, any>>(
  schema: TSchema,
  options?: {
    debugName?: string
  }
) {
  const driver = new OrmNodeDriver()
  const finalSchema = { ...schema, ...internalSyncTables }

  const db = await o.testDb(
    {
      schema: finalSchema,
      origin: 'server',
      debugName: options?.debugName || 'server',
    },
    driver
  )

  const remoteDb = new TestRemoteDb(db, driver, schema)

  return { driver, db, remoteDb, schema }
}

export async function _makeClientDb<TSchema extends Record<string, any>>(
  schema: TSchema,
  remoteDb: RemoteDb,
  options?: {
    debugName?: string
    skipPull?: boolean
    onlineDetector?: AlwaysOnlineDetector | ControllableOnlineDetector
  }
) {
  const driver = new OrmNodeDriver()

  const db = await o.syncedDb({
    schema,
    driver,
    remoteDb,
    skipPull: options?.skipPull ?? true,
    onlineDetector: options?.onlineDetector || new AlwaysOnlineDetector(),
    debugName: options?.debugName || 'client',
  })

  return { driver, db, schema }
}

export async function _makeHttpRemoteDb<TSchema extends Record<string, any>>(
  schema: TSchema,
  options?: {
    debugName?: string
    includeSyncTables?: boolean
  }
) {
  const driver = new OrmNodeDriver()
  const finalSchema = options?.includeSyncTables
    ? { ...schema, ...internalSyncTables }
    : schema

  const db = await o.testDb(
    {
      schema: finalSchema,
      origin: 'server',
      debugName: options?.debugName || 'server',
    },
    driver
  )

  const server = new RemoteDbServer(db, driver, schema)

  const mockFetch = async (url: string, options: RequestInit): Promise<Response> => {
    return await server.handleRequest(url, options.method || 'GET', options.body as string | undefined)
  }

  const remoteDb = new RemoteDbClient(mockFetch)

  return { driver, db, server, remoteDb, mockFetch, schema }
}

export interface UnstableNetworkConfig {
  failPattern?: number[] // [0,1,0] = fail, succeed, fail (0 = fail, 1 = succeed)
  delayMs?: number // Add delay to all requests
  failAfterCalls?: number // Fail after N successful calls
}

export class UnstableNetworkFetch {
  private callCount = 0

  constructor(
    private server: RemoteDbServer,
    private config: UnstableNetworkConfig = {}
  ) {}

  async fetch(url: string, options: RequestInit): Promise<Response> {
    this.callCount++

    // Check fail pattern
    if (this.config.failPattern) {
      const patternIndex = (this.callCount - 1) % this.config.failPattern.length
      const shouldSucceed = this.config.failPattern[patternIndex] === 1
      if (!shouldSucceed) {
        throw new Error('Network error (simulated)')
      }
    }

    // Check failAfterCalls
    if (this.config.failAfterCalls && this.callCount > this.config.failAfterCalls) {
      throw new Error('Network error (simulated - after N calls)')
    }

    // Add delay if configured
    if (this.config.delayMs) {
      await new Promise(resolve => setTimeout(resolve, this.config.delayMs))
    }

    // Execute actual request
    return await this.server.handleRequest(url, options.method || 'GET', options.body as string | undefined)
  }

  getCallCount(): number {
    return this.callCount
  }

  resetCallCount(): void {
    this.callCount = 0
  }

  setConfig(config: UnstableNetworkConfig): void {
    this.config = config
  }
}
