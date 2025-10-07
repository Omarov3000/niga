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
  query(sql: string, params: any[]): Promise<any[]>
}

export class RemoteDbClient implements RemoteDb {
  constructor(private fetch: (url: string, options: RequestInit) => Promise<Response>) {}

  async send(batch: DbMutationBatch[]): Promise<{ succeeded: { id: string; server_timestamp_ms: number }[]; failed: string[] }> {
    const response = await this.fetch('/sync/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    })

    if (!response.ok) {
      throw new Error(`Failed to send mutations: ${response.statusText}`)
    }

    return await response.json() as { succeeded: { id: string; server_timestamp_ms: number }[]; failed: string[] }
  }

  async get(maxServerTimestampLocally: number): Promise<Array<{ batch: DbMutationBatch; serverTimestampMs: number }>> {
    const response = await this.fetch(`/sync/get?after=${maxServerTimestampLocally}`, {
      method: 'GET',
    })

    if (!response.ok) {
      throw new Error(`Failed to get mutations: ${response.statusText}`)
    }

    return await response.json() as Array<{ batch: DbMutationBatch; serverTimestampMs: number }>
  }

  async *pull(resumeState?: PullResumeState): AsyncGenerator<Uint8Array, void, unknown> {
    const resumeStateJson = resumeState ? JSON.stringify(Array.from(resumeState.entries())) : undefined
    const url = resumeStateJson
      ? `/sync/pull?resumeState=${encodeURIComponent(resumeStateJson)}`
      : '/sync/pull'

    const response = await this.fetch(url, {
      method: 'GET',
    })

    if (!response.ok) {
      throw new Error(`Failed to pull data: ${response.statusText}`)
    }

    if (!response.body) {
      throw new Error('Response body is null')
    }

    const reader = response.body.getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        yield value
      }
    } finally {
      reader.releaseLock()
    }
  }

  async query(sql: string, params: any[]): Promise<any[]> {
    const response = await this.fetch('/sync/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    })

    if (!response.ok) {
      throw new Error(`Failed to execute query: ${response.statusText}`)
    }

    return await response.json() as any[]
  }
}

export class RemoteDbServer {
  private remoteDb: TestRemoteDb

  constructor(
    db: Db,
    driver: OrmDriver,
    schema: Record<string, any>,
    config: RemoteDbConfig = {}
  ) {
    this.remoteDb = new TestRemoteDb(db, driver, schema, config)
  }

  async handleRequest(url: string, method: string, body?: string): Promise<Response> {
    const urlObj = new URL(url, 'http://localhost')
    const pathname = urlObj.pathname

    if (pathname === '/sync/send' && method === 'POST') {
      const batch = JSON.parse(body || '[]') as DbMutationBatch[]
      const result = await this.remoteDb.send(batch)
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (pathname === '/sync/get' && method === 'GET') {
      const after = Number(urlObj.searchParams.get('after') || '0')
      const result = await this.remoteDb.get(after)
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (pathname === '/sync/pull' && method === 'GET') {
      const resumeStateParam = urlObj.searchParams.get('resumeState')
      const resumeState = resumeStateParam
        ? new Map<string, number>(JSON.parse(decodeURIComponent(resumeStateParam)))
        : undefined

      const remoteDb = this.remoteDb
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of remoteDb.pull(resumeState)) {
              controller.enqueue(chunk)
            }
            controller.close()
          } catch (error) {
            controller.error(error)
          }
        },
      })

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    }

    if (pathname === '/sync/query' && method === 'POST') {
      const { sql, params } = JSON.parse(body || '{}') as { sql: string; params: any[] }
      const result = await this.remoteDb.query(sql, params)
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not Found', { status: 404 })
  }
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
        query: 'SELECT id, value, server_timestamp_ms FROM _db_mutations_queue WHERE server_timestamp_ms > ? ORDER BY id',
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
                  operationType: 'insert',
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

              // Check if this mutation is out-of-order by comparing batch ULIDs
              // Get all mutations for this specific row
              const allMutationsForRow = await this.driver.run({
                query: 'SELECT id, value FROM _db_mutations_queue ORDER BY id ASC',
                params: [],
              })

              // Filter to mutations affecting this specific row
              const rowMutations = allMutationsForRow.filter((m: any) => {
                try {
                  const batch = JSON.parse(m.value)
                  return batch.mutation.some((mut: any) =>
                    mut.table === mutation.table &&
                    (mut.type === 'update' && mut.data.id === id || mut.type === 'delete' && mut.ids?.includes(id) || mut.type === 'insert' && mut.data.some((d: any) => d.id === id))
                  )
                } catch {
                  return false
                }
              })

              // Check if incoming batch is older than any existing batch for this row
              const newerMutations = rowMutations.filter((m: any) => m.id > mutationBatch.id)

              if (newerMutations.length > 0) {
                // Incoming mutation is OLDER (by ULID) than mutations already applied
                // Need to undo newer mutation(s), apply this one, then reapply newer ones

                // Undo all newer mutations in reverse order
                for (let i = newerMutations.length - 1; i >= 0; i--) {
                  const newerBatch = JSON.parse(newerMutations[i].value) as any
                  for (const newerMut of newerBatch.mutation) {
                    if (newerMut.type === 'update' && newerMut.undo) {
                      // Apply undo - restore original values
                      for (const undoData of newerMut.undo.data) {
                        const { id: undoId, ...undoFields } = undoData
                        const undoEncodedId = idCol?.__meta__.encode ? idCol.__meta__.encode(undoId) : undoId
                        await table.update({ data: undoFields, where: sql`id = ${undoEncodedId}` })
                      }
                    }
                  }
                }

                // Apply this older mutation
                await table.update({ data, where: sql`id = ${encodedId}` })

                // Reapply newer mutations in chronological order
                for (const newerMutation of newerMutations) {
                  const newerBatch = JSON.parse(newerMutation.value) as any
                  for (const newerMut of newerBatch.mutation) {
                    if (newerMut.type === 'update') {
                      const { id: mutId, ...mutFields } = newerMut.data
                      const mutEncodedId = idCol?.__meta__.encode ? idCol.__meta__.encode(mutId) : mutId
                      await table.update({ data: mutFields, where: sql`id = ${mutEncodedId}` })
                    }
                  }
                }

                // Don't apply the incoming mutation again - we already applied it in the sequence above
              } else {
                // Normal update - no conflict
                await table.update({ data, where: sql`id = ${encodedId}` })
              }

              // Update server timestamp for this row
              await this.driver.run({
                query: `
                  INSERT INTO _latest_server_timestamp (table_name, row_id, server_timestamp_ms, operation_type)
                  VALUES (?, ?, ?, ?)
                  ON CONFLICT(table_name, row_id) DO UPDATE SET server_timestamp_ms = ?, operation_type = ?
                `,
                params: [mutation.table, id, serverTimestampMs, 'update', serverTimestampMs, 'update'],
              })
            } else if (mutation.type === 'delete') {
              const table = (tx as any)[mutation.table]
              const idCol = table.id
              for (const id of mutation.ids) {
                const encodedId = idCol?.__meta__.encode ? idCol.__meta__.encode(id) : id

                // Check if row exists
                const existingRows = await this.driver.run({
                  query: `SELECT * FROM ${mutation.table} WHERE id = ?`,
                  params: [encodedId],
                })

                if (existingRows.length === 0) {
                  // Row already deleted - reject this delete (case 2.3)
                  throw new Error(`Cannot delete row ${id}: already deleted`)
                }

                // Check for conflict with update operations (case 2.2)
                // Reject delete if there was an UPDATE from a DIFFERENT node
                const latestRow = await this.driver.run({
                  query: 'SELECT server_timestamp_ms, operation_type FROM _latest_server_timestamp WHERE table_name = ? AND row_id = ?',
                  params: [mutation.table, id],
                })

                if (latestRow.length > 0 && latestRow[0].operation_type === 'update') {
                  // Find the batch that did the update for THIS specific row
                  const allBatches = await this.driver.run({
                    query: 'SELECT id, value FROM _db_mutations_queue ORDER BY id ASC',
                    params: [],
                  })

                  let updateNodeId: string | null = null
                  for (const batchRow of allBatches) {
                    try {
                      const batch = JSON.parse(batchRow.value)
                      // Check if this batch has an update for our specific row
                      const hasUpdateForRow = batch.mutation.some((m: any) =>
                        m.type === 'update' &&
                        m.table === mutation.table &&
                        m.data?.id === id
                      )
                      if (hasUpdateForRow) {
                        updateNodeId = batch.node?.id
                        // Keep searching - we want the LATEST update (last in order)
                      }
                    } catch {}
                  }

                  // If we found an update and it's from a different node, reject the delete
                  if (updateNodeId && updateNodeId !== mutationBatch.node?.id) {
                    throw new Error(`Cannot delete row ${id}: conflicts with update operation`)
                  }
                  // Same node or no node info → allow sequential operations
                }

                await table.delete({ where: sql`id = ${encodedId}` })

                // Update server timestamp for this row
                await this.driver.run({
                  query: `
                    INSERT INTO _latest_server_timestamp (table_name, row_id, server_timestamp_ms, operation_type)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(table_name, row_id) DO UPDATE SET server_timestamp_ms = ?, operation_type = ?
                  `,
                  params: [mutation.table, id, serverTimestampMs, 'delete', serverTimestampMs, 'delete'],
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

  async query(sql: string, params: any[]): Promise<any[]> {
    return await this.driver.run({ query: sql, params })
  }
}
