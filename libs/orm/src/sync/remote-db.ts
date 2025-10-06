import type { DbMutationBatch } from './types'
import { tableToIPC } from 'apache-arrow'
import { tableFromArrays } from 'apache-arrow'
import type { Db } from '../schema/db'
import type { OrmDriver } from '../schema/types'
import { BinaryStreamGenerator } from './stream'
import { sql } from '../utils/sql'

export interface RemoteDbConfig {
  maxMemoryMb?: number // Default: 50MB
}

export type PullResumeState = Map<string, number> // tableName -> offset

/**
 * RemoteDb interface - client-side operations for syncing with remote database
 */
export interface RemoteDb {
  send(batch: DbMutationBatch[]): Promise<{ succeeded: { id: string; server_timestamp_ms: number }[]; failed: string[] }>
  get(maxServerTimestampLocally: number): Promise<Array<{ batch: DbMutationBatch; serverTimestampMs: number }>>
  pull(resumeState?: PullResumeState): AsyncGenerator<Uint8Array, void, unknown>
}

export class TestRemoteDb implements RemoteDb {
  private maxMemoryBytes: number

  constructor(
    private db: Db,
    private driver: OrmDriver,
    private schema: Record<string, any>,
    config: RemoteDbConfig = {}
  ) {
    this.maxMemoryBytes = (config.maxMemoryMb ?? 50) * 1024 * 1024
  }

  async *pull(resumeState?: PullResumeState): AsyncGenerator<Uint8Array, void, unknown> {
    // Pull all tables from schema
    for (const tableName of Object.keys(this.schema)) {
      // Skip tables not in resume state (they're already complete with state='all')
      if (resumeState && !resumeState.has(tableName)) {
        continue
      }

      // Send table name as string
      const tableNameChunks = BinaryStreamGenerator.serializeString(tableName)
      yield BinaryStreamGenerator.combineChunks(tableNameChunks)

      // Stream table data in batches, resuming from offset if provided
      const startOffset = resumeState?.get(tableName) ?? 0
      yield* this.streamTableData(tableName, startOffset)
    }

    // Send end marker
    yield BinaryStreamGenerator.getEndMarker()
  }

  private async *streamTableData(tableName: string, startOffset: number = 0): AsyncGenerator<Uint8Array, void, unknown> {
    let offset = startOffset
    let estimatedBatchSize = 0
    // Start with 1000 rows, will adjust based on actual memory usage
    let currentBatchSize = 1000

    while (true) {
      // Fetch batch
      const rows = await this.driver.run({
        query: `SELECT * FROM ${tableName} LIMIT ? OFFSET ?`,
        params: [currentBatchSize, offset],
      })

      if (rows.length === 0) break

      const requestedBatchSize = currentBatchSize

      // Convert rows to Arrow and serialize
      const columnNames = Object.keys(rows[0])
      const columnArrays: Record<string, any[]> = {}

      for (const colName of columnNames) {
        columnArrays[colName] = rows.map((row: any) => row[colName])
      }

      const arrowTable = tableFromArrays(columnArrays)
      const serialized = tableToIPC(arrowTable)

      // Estimate average row size for next batch
      if (estimatedBatchSize === 0) {
        estimatedBatchSize = serialized.byteLength / rows.length
      }

      // Send as Uint8Array stream item
      const chunks = BinaryStreamGenerator.serializeUint8Array(serialized)
      yield BinaryStreamGenerator.combineChunks(chunks)

      offset += rows.length

      // Adjust batch size based on memory limit for next iteration
      if (estimatedBatchSize > 0) {
        const targetBatchRows = Math.floor(this.maxMemoryBytes / estimatedBatchSize)
        currentBatchSize = Math.max(100, Math.min(10000, targetBatchRows))
      }

      // Stop if we got fewer rows than requested (end of table)
      if (rows.length < requestedBatchSize) break
    }
  }

  async get(maxServerTimestampLocally: number): Promise<Array<{ batch: DbMutationBatch; serverTimestampMs: number }>> {
    try {
      const rows = await this.driver.run({
        query: 'SELECT id, value, server_timestamp_ms FROM _db_mutations_queue WHERE server_timestamp_ms > ? ORDER BY server_timestamp_ms, id',
        params: [maxServerTimestampLocally],
      })

      return rows.map((row: any) => ({
        batch: JSON.parse(row.value) as DbMutationBatch,
        serverTimestampMs: row.server_timestamp_ms,
      }))
    } catch {
      // Table doesn't exist (server is not a SyncedDb) - return empty array
      return []
    }
  }

  async send(batch: DbMutationBatch[]): Promise<{ succeeded: { id: string; server_timestamp_ms: number }[]; failed: string[] }> {
    const succeeded: { id: string; server_timestamp_ms: number }[] = []
    const failed: string[] = []

    for (const mutationBatch of batch) {
      try {
        const serverTimestampMs = Date.now()

        // Apply mutations to server db in a transaction
        await this.db.batch(async (tx) => {
          for (const mutation of mutationBatch.mutation) {
            if (mutation.type === 'insert') {
              for (const row of mutation.data) {
                await (tx as any)[mutation.table].insert(row)
                // Track server timestamp for this row
                await (tx as any)._latest_server_timestamp.insert({
                  tableName: mutation.table,
                  rowId: row.id,
                  serverTimestampMs,
                })
              }
            } else if (mutation.type === 'update') {
              const { id, ...data } = mutation.data
              const table = (tx as any)[mutation.table]
              const idCol = table.id
              const encodedId = idCol?.__meta__.encode ? idCol.__meta__.encode(id) : id

              // Check if row exists (might have been deleted)
              const existingRows = await this.driver.run({
                query: `SELECT * FROM ${mutation.table} WHERE id = ?`,
                params: [encodedId],
              })

              if (existingRows.length === 0) {
                // Row doesn't exist - was deleted. Reject this update mutation.
                throw new Error(`Cannot update deleted row: ${id}`)
              }

              // Check for existing timestamp (conflict detection)
              const latestRow = await this.driver.run({
                query: 'SELECT server_timestamp_ms FROM _latest_server_timestamp WHERE table_name = ? AND row_id = ?',
                params: [mutation.table, id],
              })

              if (latestRow.length > 0 && latestRow[0].server_timestamp_ms > serverTimestampMs) {
                // Current mutation is older than what's on server - need to merge
                const currentRow = existingRows[0]
                const mergedData = { ...currentRow, ...data }

                // Convert snake_case keys to camelCase for merge
                const camelMerged: Record<string, any> = {}
                for (const [key, value] of Object.entries(mergedData)) {
                  const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
                  camelMerged[camelKey] = value
                }

                await table.update({ data: camelMerged, where: sql`id = ${encodedId}` })
              } else {
                // Normal update - no conflict
                await table.update({ data, where: sql`id = ${encodedId}` })
              }

              // Update server timestamp for this row
              await this.driver.run({
                query: `
                  INSERT INTO _latest_server_timestamp (table_name, row_id, server_timestamp_ms)
                  VALUES (?, ?, ?)
                  ON CONFLICT(table_name, row_id) DO UPDATE SET server_timestamp_ms = ?
                `,
                params: [mutation.table, id, serverTimestampMs, serverTimestampMs],
              })
            } else if (mutation.type === 'delete') {
              const table = (tx as any)[mutation.table]
              const idCol = table.id
              for (const id of mutation.ids) {
                const encodedId = idCol?.__meta__.encode ? idCol.__meta__.encode(id) : id
                await table.delete({ where: sql`id = ${encodedId}` })

                // Update server timestamp for this row
                await this.driver.run({
                  query: `
                    INSERT INTO _latest_server_timestamp (table_name, row_id, server_timestamp_ms)
                    VALUES (?, ?, ?)
                    ON CONFLICT(table_name, row_id) DO UPDATE SET server_timestamp_ms = ?
                  `,
                  params: [mutation.table, id, serverTimestampMs, serverTimestampMs],
                })
              }
            }
          }

          // Store mutation in server's queue with timestamp
          await (tx as any)._db_mutations_queue.insert({
            id: mutationBatch.id,
            value: JSON.stringify(mutationBatch),
            serverTimestampMs,
          })
        })

        succeeded.push({ id: mutationBatch.id, server_timestamp_ms: serverTimestampMs })
      } catch (error) {
        failed.push(mutationBatch.id)
      }
    }

    return { succeeded, failed }
  }
}
