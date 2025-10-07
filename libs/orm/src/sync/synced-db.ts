import { Db } from '../schema/db'
import type { Table } from '../schema/table'
import type { OrmDriver } from '../schema/types'
import type { RemoteDb, PullResumeState } from './remote-db'
import { RemoteDbClient } from './remote-db'
import { internalSyncTables } from './internal-tables'
import { SyncedTable } from './synced-table'
import type { DbMutation, DbMutationBatch, OnlineDetector } from './types'
import { BinaryStreamParser } from './stream'
import { tableFromIPC } from 'apache-arrow'
import { ulid, monotonicFactory } from 'ulidx'
import { sql } from '../utils/sql'
import { OrmMigratingDriver } from '../schema/orm-migrating-driver'
import { createFetchWrapper } from './fetch-wrapper'

export interface SyncedDbOptions {
  schema: Record<string, Table<any, any>>
  driver: OrmDriver
  fetch?: (url: string, options: RequestInit) => Promise<Response>
  onlineDetector: OnlineDetector
  name?: string
  debugName?: string
  logging?: boolean
  skipPull?: boolean // For tests: skip pull phase, only sync mutations
  remoteDb?: RemoteDb // For tests: override the remoteDb creation. If provided, fetch is ignored
}

// Type for the batch transaction - includes all schema tables plus internal tables
type SyncedDbBatch = Record<string, Table<any, any>> & {
  _db_mutations_queue: typeof internalSyncTables._db_mutations_queue
  _db_mutations_queue_dead: typeof internalSyncTables._db_mutations_queue_dead
  _sync_pull_progress: typeof internalSyncTables._sync_pull_progress
  _sync_node: typeof internalSyncTables._sync_node
}

export type SyncState = 'pulling' | 'gettingLatest' | 'synced'

export class SyncedDb extends Db {
  private remoteDb: RemoteDb
  private userSchema: Record<string, Table<any, any>>
  private localDriver: OrmDriver
  private skipPull: boolean
  public syncState: SyncState = 'pulling'
  private nodeInfo: { id: string; name: string }
  private ulid: ReturnType<typeof monotonicFactory>
  private mutationsDuringSync: boolean = false

  constructor(opts: SyncedDbOptions) {
    // Merge user schema with internal tables
    const fullSchema = { ...opts.schema, ...internalSyncTables }

    super({
      schema: fullSchema,
      name: opts.name ?? 'synced',
      debugName: opts.debugName,
      origin: 'client',
      logging: opts.logging,
    })

    this.userSchema = opts.schema
    // Create remoteDb with fetch wrapper, or use provided remoteDb for tests
    if (opts.remoteDb) {
      this.remoteDb = opts.remoteDb
    } else {
      if (!opts.fetch) {
        throw new Error('Either fetch or remoteDb must be provided to SyncedDb')
      }
      this.remoteDb = new RemoteDbClient(
        createFetchWrapper(opts.fetch, opts.onlineDetector)
      )
    }
    this.skipPull = opts.skipPull ?? false
    this.ulid = monotonicFactory()
    this.nodeInfo = { id: ulid(), name: '' }

    // Wrap driver with migration support - use minimal mode to skip FK constraints for offline support
    const migratingDriver = new OrmMigratingDriver(opts.driver, this, opts.logging, 'minimal')
    this.localDriver = migratingDriver
    this._connectDriver(migratingDriver)

    // Initialize will be called separately since constructor can't be async
  }

  async initialize(): Promise<void> {
    // Migration is handled automatically by OrmMigratingDriver on first database access

    // Initialize node info (load from DB or create new)
    await this.initializeNodeInfo()

    // Wrap user tables as SyncedTable instances EARLY so writes can be queued
    // This allows writes to work even during initialization
    this.wrapTablesAsSynced()

    if (this.skipPull) {
      // Mark all tables as complete without pulling
      await this.markAllTablesComplete()
      this.syncState = 'gettingLatest'
    } else {
      // Check if pull is completed
      const pullCompleted = await this.isPullCompleted()

      if (!pullCompleted) {
        // Pull not complete - either first time or interrupted
        this.syncState = 'pulling'
        await this.pullAll()
      }
      this.syncState = 'gettingLatest'
    }

    // BLOCKING: Sync mutations from server (make initial sync blocking)
    await this.syncMutationsFromServer()

    // Resume sending any queued mutations that failed previously
    await this.resumeQueuedMutations()

    this.syncState = 'synced'

    // If mutations were made during sync, we need to pull them back from server
    if (this.mutationsDuringSync) {
      this.mutationsDuringSync = false
      await this.syncMutationsFromServer()
    }
  }

  private async initializeNodeInfo(): Promise<void> {
    try {
      const existing = await this.localDriver.run({
        query: 'SELECT id, name FROM _sync_node LIMIT 1',
        params: [],
      })

      if (existing.length > 0) {
        // Load existing node info
        this.nodeInfo = {
          id: existing[0].id,
          name: existing[0].name,
        }
      } else {
        // Create new node record
        await this.localDriver.run({
          query: 'INSERT INTO _sync_node (id, name) VALUES (?, ?)',
          params: [this.nodeInfo.id, this.nodeInfo.name],
        })
      }
    } catch (error) {
      // Table doesn't exist or error - keep in-memory nodeInfo
    }
  }

  private async markAllTablesComplete(): Promise<void> {
    for (const tableName of Object.keys(this.userSchema)) {
      await this.setPullProgress(tableName, 'all')
    }
  }

  private async syncMutationsFromServer(): Promise<void> {
    // Get max server timestamp from local queue
    const maxTimestamp = await this.getMaxServerTimestamp()

    // Fetch new mutations from server
    const mutations = await this.remoteDb.get(maxTimestamp)

    // Apply each mutation batch with its server timestamp
    for (const { batch, serverTimestampMs } of mutations) {
      await this.applyMutationBatch(batch, serverTimestampMs)
    }
  }

  private async getMaxServerTimestamp(): Promise<number> {
    try {
      const result = await this.localDriver.run({
        query: 'SELECT MAX(server_timestamp_ms) as max_ts FROM _db_mutations_queue',
        params: [],
      })

      return result[0]?.max_ts ?? 0
    } catch {
      return 0
    }
  }

  private async applyMutationBatch(batch: DbMutationBatch, serverTimestampMs: number): Promise<void> {
    // Check if already applied
    const existing = await this.localDriver.run({
      query: 'SELECT id FROM _db_mutations_queue WHERE id = ?',
      params: [batch.id],
    })

    if (existing.length > 0) {
      // Already applied, skip
      return
    }

    // Apply mutations in transaction
    await this.batch(async (tx: SyncedDbBatch) => {
      for (const mutation of batch.mutation) {
        // as any: Dynamic table access by name from mutation - TS can't infer specific table type
        const table = tx[mutation.table] as any
        if (!table) continue

        if (mutation.type === 'insert') {
          for (const row of mutation.data) {
            await table.insert(row)
          }
        } else if (mutation.type === 'update') {
          const { id, ...data } = mutation.data
          // Manually encode ID for WHERE clause
          const idCol = (table as any).id
          const encodedId = idCol?.__meta__.encode ? idCol.__meta__.encode(id) : id
          await table.update({ data, where: sql`id = ${encodedId}` })
        } else if (mutation.type === 'delete') {
          const idCol = (table as any).id
          for (const id of mutation.ids) {
            const encodedId = idCol?.__meta__.encode ? idCol.__meta__.encode(id) : id
            await table.delete({ where: sql`id = ${encodedId}` })
          }
        }
      }

      // Store mutation in local queue with server timestamp
      await tx._db_mutations_queue.insert({
        id: batch.id,
        value: JSON.stringify(batch),
        serverTimestampMs,
      })
    })
  }

  private async isPullCompleted(): Promise<boolean> {
    try {
      const progress = await this.localDriver.run({
        query: 'SELECT table_name, state FROM _sync_pull_progress',
        params: [],
      })

      const progressMap = new Map<string, string>()
      for (const row of progress) {
        progressMap.set(row.table_name, row.state)
      }

      // Check all schema tables
      for (const tableName of Object.keys(this.userSchema)) {
        const state = progressMap.get(tableName)
        if (!state || state !== 'all') {
          return false
        }
      }

      return true
    } catch {
      // Table doesn't exist or error - not completed
      return false
    }
  }


  private async pullAll(): Promise<void> {
    // Get resume state from progress table
    const resumeState = await this.getResumeState()

    // Pull all tables using streaming
    const stream = this.remoteDb.pull(resumeState)
    const parser = new BinaryStreamParser()

    let currentTable: string | null = null
    let currentTableRows: Record<string, any>[] = []
    let currentTableOffset = 0

    for await (const chunk of stream) {
      const items = parser.addChunk(chunk)

      for (const item of items) {
        if (item.type === 'end') {
          // Flush any remaining rows and mark table as complete
          if (currentTable && currentTableRows.length > 0) {
            await this.insertRowsWithProgress(currentTable, currentTableRows, currentTableOffset)
            currentTableOffset += currentTableRows.length
          }
          // Mark final table as complete
          if (currentTable) {
            await this.setPullProgress(currentTable, 'all')
          }
          return
        } else if (item.type === 'string') {
          // New table - flush previous table and mark as complete
          if (currentTable && currentTableRows.length > 0) {
            await this.insertRowsWithProgress(currentTable, currentTableRows, currentTableOffset)
            currentTableOffset += currentTableRows.length
          }
          if (currentTable) {
            await this.setPullProgress(currentTable, 'all')
          }

          // Start new table
          currentTable = item.data
          currentTableRows = []
          currentTableOffset = resumeState?.get(item.data) ?? 0
        } else if (item.type === 'uint8array') {
          // Arrow batch - deserialize and accumulate rows
          const arrowTable = tableFromIPC(item.data)
          const batchRows: Record<string, any>[] = []

          for (let i = 0; i < arrowTable.numRows; i++) {
            const row = arrowTable.get(i)?.toJSON()
            if (row) batchRows.push(row)
          }

          currentTableRows.push(...batchRows)

          // Insert batch and update progress in transaction
          if (currentTable && currentTableRows.length > 0) {
            await this.insertRowsWithProgress(currentTable, currentTableRows, currentTableOffset)
            currentTableOffset += currentTableRows.length
            await this.setPullProgress(currentTable, currentTableOffset)
            currentTableRows = []
          }
        }
      }
    }
  }

  private async insertRowsWithProgress(tableName: string, rows: Record<string, any>[], offset: number): Promise<void> {
    const table = this.userSchema[tableName]
    if (!table) return

    // Convert snake_case column names to camelCase
    const convertedRows = rows.map(row => {
      const converted: Record<string, any> = {}
      for (const [key, value] of Object.entries(row)) {
        const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
        converted[camelKey] = value
      }
      return converted
    })

    // Insert rows and update progress in transaction
    await this.batch(async (batch: SyncedDbBatch) => {
      // as any: Dynamic table access by name - TS can't infer specific table type from string variable
      const batchTable = batch[tableName] as any
      if (!batchTable) return

      for (const row of convertedRows) {
        await batchTable.insert(row)
      }
    })
  }

  private async getResumeState(): Promise<PullResumeState | undefined> {
    try {
      const progress = await this.localDriver.run({
        query: 'SELECT table_name, state FROM _sync_pull_progress',
        params: [],
      })

      const progressMap = new Map<string, string>()
      for (const row of progress) {
        progressMap.set(row.table_name, row.state)
      }

      const resumeState = new Map<string, number>()

      // For each table in schema, determine if we need to resume
      for (const tableName of Object.keys(this.userSchema)) {
        const state = progressMap.get(tableName)

        if (!state) {
          // No entry - start from beginning
          resumeState.set(tableName, 0)
        } else if (state !== 'all') {
          // Numeric offset - resume from there
          resumeState.set(tableName, parseInt(state, 10))
        }
        // If state='all', don't add to map (table already complete)
      }

      return resumeState.size > 0 ? resumeState : undefined
    } catch {
      // Table doesn't exist - start from scratch
      const resumeState = new Map<string, number>()
      for (const tableName of Object.keys(this.userSchema)) {
        resumeState.set(tableName, 0)
      }
      return resumeState
    }
  }


  private async setPullProgress(tableName: string, state: number | 'all'): Promise<void> {
    // Upsert progress with new state (offset or 'all')
    const stateValue = typeof state === 'number' ? state.toString() : state
    await this.localDriver.run({
      query: `
        INSERT INTO _sync_pull_progress (table_name, state)
        VALUES (?, ?)
        ON CONFLICT(table_name) DO UPDATE SET state = ?
      `,
      params: [tableName, stateValue, stateValue],
    })
  }

  private wrapTablesAsSynced(): void {
    for (const [name, table] of Object.entries(this.userSchema)) {
      const typedThis = this as unknown as Record<string, unknown>

      // Create SyncedTable with same options as the original table
      const syncedTable = new SyncedTable(
        {
          // as any: Table name is a string literal type but we're creating dynamically - TS can't narrow the type
          name: table.__meta__.name as any,
          columns: table.__columns__,
          indexes: table.__meta__.indexes,
          constrains: table.__meta__.constrains,
        },
        this.enqueueMutation.bind(this)
      )

      // Connect to the same driver and db context
      // TypeScript doesn't allow direct assignment to readonly properties, but we need to initialize it
      Object.defineProperty(syncedTable, '__db__', {
        value: {
          getDriver: () => {
            if (!this.localDriver) throw new Error('No driver connected.')
            return this.localDriver
          },
          getCurrentUser: () => this.currentUser,
          getSchema: () => this.options.schema,
          isProd: () => this.options.isProd ? this.options.isProd() : false,
        },
        writable: false,
        enumerable: false,
        configurable: false,
      })

      typedThis[name] = syncedTable
    }
  }

  private async enqueueMutation(mutation: DbMutation): Promise<boolean> {
    const batch: DbMutationBatch = {
      id: this.ulid(Date.now()),
      dbName: this.options.name ?? 'synced',
      mutation: [mutation],
      node: this.nodeInfo,
    }

    // During sync, send directly to remote but DON'T queue/apply locally
    if (this.syncState !== 'synced') {
      // Mark that we made mutations during sync - need to re-sync after initialization
      this.mutationsDuringSync = true

      // Send to remote server - don't block
      // The fetch wrapper will retry indefinitely on network errors
      // Errors will propagate to caller
      this.remoteDb.send([batch])

      // Return false to indicate: don't apply locally
      return false
    }

    // After sync is complete, store in local queue
    await this.localDriver.run({
      query: `
        INSERT INTO _db_mutations_queue (id, value, server_timestamp_ms)
        VALUES (?, ?, 0)
      `,
      params: [batch.id, JSON.stringify(batch)],
    })

    // Send to remote server in background (don't wait - fire and forget)
    // The fetch wrapper will handle retries indefinitely
    this.remoteDb.send([batch]).then(async (result) => {
      // Update local queue with server timestamp for succeeded mutations
      for (const succeeded of result.succeeded) {
        await this.localDriver.run({
          query: `
            UPDATE _db_mutations_queue
            SET server_timestamp_ms = ?
            WHERE id = ?
          `,
          params: [succeeded.server_timestamp_ms, succeeded.id],
        })
      }
    })

    // Return true to indicate: apply locally
    return true
  }

  private async resumeQueuedMutations(): Promise<void> {
    // Get all mutations that haven't been synced to server (server_timestamp_ms = 0)
    const queuedMutations = await this.localDriver.run({
      query: 'SELECT id, value FROM _db_mutations_queue WHERE server_timestamp_ms = 0 ORDER BY id',
      params: [],
    })

    if (queuedMutations.length === 0) return

    // Retry sending each batch
    for (const row of queuedMutations) {
      const batch = JSON.parse(row.value) as DbMutationBatch

      // Send to remote server (fetch wrapper handles retries)
      const result = await this.remoteDb.send([batch])

      // Update server timestamps for succeeded mutations
      for (const succeeded of result.succeeded) {
        await this.localDriver.run({
          query: `
            UPDATE _db_mutations_queue
            SET server_timestamp_ms = ?
            WHERE id = ?
          `,
          params: [succeeded.server_timestamp_ms, succeeded.id],
        })
      }
    }
  }
}

/**
 * Maps a schema of Tables to a schema where each table is a SyncedTable
 * SyncedTable extends BaseTable (same read methods) but has *WithUndo mutations instead
 */
type SyncedSchema<TSchema extends Record<string, Table<any, any>>> = {
  [K in keyof TSchema]: TSchema[K] extends Table<infer Name, infer TCols>
    ? SyncedTable<Name, TCols> & TCols
    : never
}

/**
 * Factory function to create a SyncedDb instance
 */
export async function syncedDb<TSchema extends Record<string, Table<any, any>>>(
  opts: SyncedDbOptions & { schema: TSchema }
): Promise<SyncedDb & SyncedSchema<TSchema>> {
  const instance = new SyncedDb(opts)
  await instance.initialize()

  return instance as SyncedDb & SyncedSchema<TSchema>
}
