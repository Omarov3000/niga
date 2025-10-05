import { tableFromArrays, tableToIPC, tableFromIPC } from 'apache-arrow'

export interface TableData {
  tableName: string
  rows: Record<string, any>[]
}

/**
 * Serialize multiple tables to Apache Arrow IPC format in a single Blob
 *
 * Format: For each table:
 *   [4 bytes: table name length]
 *   [N bytes: table name UTF-8]
 *   [4 bytes: Arrow IPC data length]
 *   [M bytes: Arrow IPC serialized data]
 */
export async function serializeTablesToArrow(tables: TableData[]): Promise<Blob> {
  const chunks: Uint8Array[] = []
  const encoder = new TextEncoder()

  for (const { tableName, rows } of tables) {
    // Encode table name with length prefix
    const tableNameBytes = encoder.encode(tableName)
    const tableNameLength = new Uint32Array([tableNameBytes.length])
    chunks.push(new Uint8Array(tableNameLength.buffer))
    chunks.push(tableNameBytes)

    if (rows.length === 0) {
      // Empty table marker
      chunks.push(new Uint8Array(new Uint32Array([0]).buffer))
      continue
    }

    // Build column arrays from rows
    const columnNames = Object.keys(rows[0])
    const columnArrays: Record<string, any[]> = {}

    for (const colName of columnNames) {
      columnArrays[colName] = rows.map(row => row[colName])
    }

    // Create Arrow table
    const arrowTable = tableFromArrays(columnArrays)

    // Serialize using Arrow's tableToIPC
    const serialized = tableToIPC(arrowTable)

    // Write serialized data length then data
    const dataLength = new Uint32Array([serialized.byteLength])
    chunks.push(new Uint8Array(dataLength.buffer))
    chunks.push(serialized)
  }

  // Combine all chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const combined = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.length
  }

  return new Blob([combined], { type: 'application/octet-stream' })
}

/**
 * Deserialize Apache Arrow IPC format Blob back to table data
 *
 * Parses the binary format produced by serializeTablesToArrow
 * Returns a Map of table name to rows (as plain objects)
 */
export async function deserializeArrowToTables(blob: Blob): Promise<Map<string, Record<string, any>[]>> {
  const buffer = await blob.arrayBuffer()
  const data = new Uint8Array(buffer)
  const result = new Map<string, Record<string, any>[]>()
  const decoder = new TextDecoder()

  let offset = 0

  while (offset < data.length) {
    // Read table name length
    const tableNameLength = new Uint32Array(data.slice(offset, offset + 4).buffer)[0]
    offset += 4

    // Read table name
    const tableNameBytes = data.slice(offset, offset + tableNameLength)
    const tableName = decoder.decode(tableNameBytes)
    offset += tableNameLength

    // Read data length
    const dataLength = new Uint32Array(data.slice(offset, offset + 4).buffer)[0]
    offset += 4

    if (dataLength === 0) {
      // Empty table
      result.set(tableName, [])
      continue
    }

    // Read serialized Arrow data
    const serializedData = data.slice(offset, offset + dataLength)
    offset += dataLength

    // Deserialize Arrow table using tableFromIPC
    const deserialized = tableFromIPC(serializedData)

    // Convert Arrow table to row objects
    const rows: Record<string, any>[] = []
    for (let i = 0; i < deserialized.numRows; i++) {
      const row = deserialized.get(i)?.toJSON()
      if (row) rows.push(row)
    }

    result.set(tableName, rows)
  }

  return result
}
