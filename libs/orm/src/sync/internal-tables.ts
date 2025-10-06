import { Table } from '../schema/table'
import { Column } from '../schema/column'
import { toSnakeCase } from '../utils/casing'

function text() {
  return new Column<'text', string, 'optional'>({ kind: 'public', name: 'text', type: 'text' })
}

function integer() {
  return new Column<'integer', number, 'optional'>({ kind: 'public', name: 'integer', type: 'integer' })
}

function makeTable<Name extends string, TCols extends Record<string, Column<any, any, any>>>(
  name: Name,
  columns: TCols,
  constrains?: [string, ...string[]][]
): Table<Name, TCols> & TCols {
  Object.entries(columns).forEach(([colName, col]) => {
    (col as any).__meta__.name = colName as any
    (col as any).__meta__.dbName = toSnakeCase(colName)
  })

  // Convert camelCase column names in constrains to snake_case
  const normalizedConstrains = constrains?.map(constraint => {
    const [type, ...colNames] = constraint
    const snakeCaseNames = colNames.map(name => toSnakeCase(name))
    return [type, ...snakeCaseNames]
  })

  const instance = new Table<Name, TCols>({
    name,
    columns: columns as any,
    constrains: normalizedConstrains as any,
  }) as any

  Object.entries(columns).forEach(([colName, col]) => {
    instance[colName] = col
  })

  return instance as Table<Name, TCols> & TCols
}

// _db_mutations_queue table
const _dbMutationsQueueColumns = {
  id: text().primaryKey(),
  value: text().notNull(),
  serverTimestampMs: integer().notNull().default(0),
}

export const _dbMutationsQueue = makeTable('_db_mutations_queue', _dbMutationsQueueColumns)

// _db_mutations_queue_dead table
const _dbMutationsQueueDeadColumns = {
  id: text().primaryKey(),
  value: text().notNull(),
  reason: text().notNull(),
}

export const _dbMutationsQueueDead = makeTable('_db_mutations_queue_dead', _dbMutationsQueueDeadColumns)

// _sync_pull_progress table
const _syncPullProgressColumns = {
  tableName: text().primaryKey(),
  state: text().notNull(), // number (offset) or 'all' (fully synced)
}

export const _syncPullProgress = makeTable('_sync_pull_progress', _syncPullProgressColumns)

// _sync_node table
const _syncNodeColumns = {
  id: text().primaryKey(),
  name: text().notNull(),
}

export const _syncNode = makeTable('_sync_node', _syncNodeColumns)

// _latest_server_timestamp table
const _latestServerTimestampColumns = {
  tableName: text().notNull(),
  rowId: text().notNull(),
  serverTimestampMs: integer().notNull(),
  operationType: text().notNull(), // 'insert', 'update', or 'delete'
}

export const _latestServerTimestamp = makeTable('_latest_server_timestamp', _latestServerTimestampColumns, [['primaryKey', 'tableName', 'rowId']])

export const internalSyncTables = {
  _db_mutations_queue: _dbMutationsQueue,
  _db_mutations_queue_dead: _dbMutationsQueueDead,
  _sync_pull_progress: _syncPullProgress,
  _sync_node: _syncNode,
  _latest_server_timestamp: _latestServerTimestamp,
}
