import { Db } from '../schema/db'
import type { Table } from '../schema/table'
import type { OrmDriver } from '../schema/types'
import type { RemoteDb, PullResumeState } from './remote-db'
import { internalSyncTables } from './internal-tables'
import { SyncedTable } from './synced-table'
import type { DbMutation, DbMutationBatch } from './types'
import { BinaryStreamParser } from './stream'
import { tableFromIPC } from 'apache-arrow'
import { ulid } from 'ulidx'

export interface SyncedDbOptions {
  schema: Record<string, Table<any, any>>
  driver: OrmDriver
  remoteDb: RemoteDb
  name?: string
  skipPull?: boolean // For tests: skip pull phase, only sync mutations
}

// Type for the batch transaction - includes all schema tables plus internal tables
type SyncedDbBatch = Record<string, Table<any, any>> & {
  _db_mutations_queue: typeof internalSyncTables._db_mutations_queue
  _db_mutations_queue_dead: typeof internalSyncTables._db_mutations_queue_dead
  _sync_pull_progress: typeof internalSyncTables._sync_pull_progress
}

export class SyncedDb extends Db {
  private remoteDb: RemoteDb
  private userSchema: Record<string, Table<any, any>>
  private localDriver: OrmDriver
  private skipPull: boolean

  constructor(opts: SyncedDbOptions) {
    // Merge user schema with internal tables
    const fullSchema = { ...opts.schema, ...internalSyncTables }

    super({
      schema: fullSchema,
      name: opts.name ?? 'synced',
      origin: 'client',
    })

    this.userSchema = opts.schema
    this.remoteDb = opts.remoteDb
    this.localDriver = opts.driver
    this.skipPull = opts.skipPull ?? false

    // Connect driver
    this._connectDriver(opts.driver)

    // Initialize will be called separately since constructor can't be async
  }

  async initialize(): Promise<void> {
    // Run migrations to create all tables (user + internal)
    const snapshot = this._prepareSnapshot()
    if (snapshot.hasChanges) {
      try {
        await this.localDriver.exec(snapshot.migration.sql)
      } catch (error) {
        // Tables may already exist if reusing the same driver
        // This is expected when creating multiple SyncedDb instances with the same driver
      }
    }

    if (this.skipPull) {
      // Mark all tables as complete without pulling
      await this.markAllTablesComplete()
    } else {
      // Check if pull is completed
      const pullCompleted = await this.isPullCompleted()

      if (!pullCompleted) {
        // Pull not complete - either first time or interrupted
        await this.pullAll()
      }
    }

    // Sync mutations from server
    await this.syncMutationsFromServer()

    // Wrap user tables as SyncedTable instances
    this.wrapTablesAsSynced()
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
          await table.update(mutation.data)
        } else if (mutation.type === 'delete') {
          for (const id of mutation.ids) {
            await table.delete({ id })
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

  private async enqueueMutation(mutation: DbMutation): Promise<void> {
    const batch: DbMutationBatch = {
      id: ulid(),
      dbName: this.options.name ?? 'synced',
      mutation: [mutation],
      node: {
        id: ulid(),
        name: 'client', // TODO: get from system
      },
    }

    // Store in local queue and send to remote
    await this.localDriver.run({
      query: `
        INSERT INTO _db_mutations_queue (id, value, server_timestamp_ms)
        VALUES (?, ?, 0)
      `,
      params: [batch.id, JSON.stringify(batch)],
    })

    // Send to remote server
    const result = await this.remoteDb.send([batch])

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

    // Handle failures (future: move to dead queue)
    if (result.failed.length > 0) {
      console.error('Failed to sync mutations:', result.failed)
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
