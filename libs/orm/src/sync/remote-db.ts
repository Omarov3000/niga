import type { DbMutationBatch } from './types'
import { tableToIPC } from 'apache-arrow'
import { tableFromArrays } from 'apache-arrow'
import type { Db } from '../schema/db'
import type { OrmDriver } from '../schema/types'
import { BinaryStreamGenerator } from './stream'

export interface RemoteDbConfig {
  maxMemoryMb?: number // Default: 50MB
}

export type PullResumeState = Map<string, number> // tableName -> offset

export class TestRemoteDb {
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

  async send(_batch: DbMutationBatch[]): Promise<{ succeeded: { id: string; server_timestamp_ms: number }[]; failed: string[] }> {
    throw new Error('send not implemented')
  }

  async get(_maxServerTimestampLocally: number): Promise<DbMutationBatch[]> {
    throw new Error('get not implemented')
  }
}
